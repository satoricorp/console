import {
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandOutput,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { Hono } from "hono";
import { getSql } from "../db";
import {
  awsRegion,
  bedrockConfigured,
  getBedrockClient,
  SERVER_BEDROCK_ANTHROPIC_MODEL,
} from "../llm/provider";
import {
  checkCloudAIQuota,
  TrialEntitlementUnavailableError,
} from "../metering/quota";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { logTiming, timingNow } from "../timing";

/**
 * POST /gx/bedrock/fight — the transport the CLI's review fight runs over.
 *
 * TX holds the AWS credentials, so end users never need an AWS account. This is
 * a thin passthrough to Bedrock Converse: retrieval, brief construction, the
 * two-reviewer fan-out and the judge all stay in the CLI (internal/codereview).
 * Nothing here knows what a review is — it takes messages, calls one model, and
 * hands the text back.
 *
 * The CLI's local leg speaks the Anthropic messages shape (InvokeModel:
 * `{anthropic_version, system, messages, max_tokens}` in, `{content:[{type,text}]}`
 * out). This route accepts that shape *and* the Converse shape, and answers with
 * both — Converse's `output`/`stopReason`/`usage` plus an Anthropic-compatible
 * `content`/`stop_reason`/`usage` mirror — so the cloud leg is the same body
 * builder and the same parser the direct leg already uses, only with a different
 * URL and bearer auth. One shape in the CLI means one place to fix.
 */
export const bedrockRoutes = new Hono<AppEnv>();

/**
 * The models this endpoint will spend TX's Bedrock budget on. It is NOT an open
 * Bedrock proxy: any authenticated caller can reach it, so an unconstrained
 * `modelId` would let one hand a review-priced request to whatever the most
 * expensive model in the account happens to be.
 *
 * The composition (kept in sync with internal/codereview/ai.go):
 *   reviewer A  opus-4-6   ┐ two flagship reviewers run concurrently in the CLI,
 *   reviewer B  opus-4-5   ┘ so the pair costs max(A,B) wall clock, not A+B, and
 *                            two Opus models from DIFFERENT generations
 *                            decorrelate failure modes far better than one Opus
 *                            plus a smaller same-generation sibling would.
 *   judge       sonnet-4-6  a third model, so it is never grading its own
 *                            output; it also sits on the sequential path after
 *                            both reviewers return, which is where latency
 *                            hurts, hence the smaller model.
 *
 * Every ID must be the `us.`-prefixed inference profile form — bedrock-runtime
 * rejects bare `anthropic.*` IDs for on-demand invocation. Adding a model is one
 * edit here.
 */
export const BEDROCK_FIGHT_MODELS = [
  "us.anthropic.claude-opus-4-6-v1",
  "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "us.anthropic.claude-sonnet-4-6",
] as const;

/** Allowlist = the fight models plus whatever this server already calls itself. */
const allowedModels: ReadonlySet<string> = new Set<string>([
  ...BEDROCK_FIGHT_MODELS,
  SERVER_BEDROCK_ANTHROPIC_MODEL,
]);

export function allowedBedrockModels(): string[] {
  return [...allowedModels].sort();
}

export function isAllowedBedrockModel(model: string): boolean {
  return allowedModels.has(model.trim());
}

/** Bounds. One caller must not be able to pin the server or the budget. */
const defaultMaxRequestBytes = 2 * 1024 * 1024; // ~200k tokens of prose/code
const defaultTimeoutMs = 300_000; // matches the /gx/openai passthrough
const defaultMaxOutputTokens = 4096;
const maxOutputTokensCeiling = 32_000;
const maxMessages = 200;
const maxStopSequences = 16;

function positiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function maxRequestBytes(): number {
  return positiveEnvInt("TX_CLOUD_BEDROCK_MAX_BODY_BYTES", defaultMaxRequestBytes);
}

function requestTimeoutMs(): number {
  return positiveEnvInt("TX_CLOUD_BEDROCK_TIMEOUT_MS", defaultTimeoutMs);
}

bedrockRoutes.use("*", requireAuth);

// Cloud AI is a paid feature (with a free-trial window). Same gate as
// /gx/openai — past-trial free orgs get a clean 402 the CLI turns into an
// upgrade hint instead of burning tokens on TX's account.
bedrockRoutes.use("*", async (c, next) => {
  const auth = c.get("auth");
  let quota;
  try {
    quota = await checkCloudAIQuota(getSql(), auth.orgId, auth.userId);
  } catch (error) {
    if (error instanceof TrialEntitlementUnavailableError) {
      return c.json(
        {
          error: "entitlement_unavailable",
          message: "TX entitlement service is unavailable. Please retry.",
        },
        503,
      );
    }
    throw error;
  }
  if (!quota.allowed) {
    return c.json(
      {
        error: "payment_required",
        reason: quota.reason ?? "trial_expired",
        message:
          "TX free trial has ended for this org. Upgrade to keep using TX Cloud AI, or set your own model key with `tx set key`.",
        upgrade_url: quota.upgradeUrl,
        trial_ends_at: quota.trialEndsAt ?? null,
      },
      402,
    );
  }
  await next();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type FightRequest = {
  modelId: string;
  messages: Message[];
  system?: SystemContentBlock[];
  inferenceConfig: {
    maxTokens: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  };
};

/**
 * Keys this endpoint understands. Anything else is a 400 rather than a silent
 * no-op: a caller who writes `maxTokens` at the top level instead of inside
 * `inferenceConfig` should be told, not quietly given the 4096 default.
 * `anthropic_version` is accepted and ignored — Converse sets it itself, and the
 * CLI's local leg has to send it.
 */
const knownRequestKeys = new Set([
  "model",
  "modelId",
  "messages",
  "system",
  "inferenceConfig",
  "max_tokens",
  "temperature",
  "top_p",
  "topP",
  "stop_sequences",
  "stopSequences",
  "anthropic_version",
]);

function textBlocks(value: unknown, field: string): ContentBlock[] | string {
  if (typeof value === "string") {
    if (value.trim() === "") return `${field} must not be empty`;
    return [{ text: value }];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return `${field} must be a non-empty string or an array of text blocks`;
  }
  const blocks: ContentBlock[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.text !== "string" || raw.text.trim() === "") {
      return `${field} blocks must each be {"text": "..."} with non-empty text`;
    }
    blocks.push({ text: raw.text });
  }
  return blocks;
}

function boundedNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${field} must be a number`;
  }
  if (value < min || value > max) {
    return `${field} must be between ${min} and ${max}`;
  }
  return value;
}

/**
 * Normalize either accepted request shape into one Converse call, or return the
 * reason it is not a valid request. Exported for unit tests.
 */
export function normalizeFightRequest(
  payload: unknown,
): { ok: true; request: FightRequest } | { ok: false; error: string } {
  if (!isRecord(payload)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const unknownKeys = Object.keys(payload).filter((key) => !knownRequestKeys.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `Unsupported field(s): ${unknownKeys.sort().join(", ")}. Supported: ${[...knownRequestKeys].sort().join(", ")}`,
    };
  }

  const rawModel = payload.model ?? payload.modelId;
  if (typeof rawModel !== "string" || rawModel.trim() === "") {
    return { ok: false, error: "model is required" };
  }
  const modelId = rawModel.trim();

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return { ok: false, error: "messages must be a non-empty array" };
  }
  if (payload.messages.length > maxMessages) {
    return { ok: false, error: `messages must contain at most ${maxMessages} entries` };
  }

  const messages: Message[] = [];
  for (const [index, raw] of payload.messages.entries()) {
    if (!isRecord(raw)) {
      return { ok: false, error: `messages[${index}] must be an object` };
    }
    if (raw.role !== "user" && raw.role !== "assistant") {
      return {
        ok: false,
        error: `messages[${index}].role must be "user" or "assistant" (use the top-level system field for system prompts)`,
      };
    }
    const content = textBlocks(raw.content, `messages[${index}].content`);
    if (typeof content === "string") {
      return { ok: false, error: content };
    }
    messages.push({ role: raw.role, content });
  }

  let system: SystemContentBlock[] | undefined;
  if (payload.system !== undefined) {
    const blocks = textBlocks(payload.system, "system");
    if (typeof blocks === "string") {
      return { ok: false, error: blocks };
    }
    system = blocks.map((block) => ({ text: block.text as string }));
  }

  const rawInference = payload.inferenceConfig;
  if (rawInference !== undefined && !isRecord(rawInference)) {
    return { ok: false, error: "inferenceConfig must be an object" };
  }
  const inference = (rawInference ?? {}) as Record<string, unknown>;

  const rawMaxTokens = inference.maxTokens ?? payload.max_tokens;
  let maxTokens = defaultMaxOutputTokens;
  if (rawMaxTokens !== undefined) {
    const bounded = boundedNumber(rawMaxTokens, "maxTokens", 1, maxOutputTokensCeiling);
    if (typeof bounded === "string") {
      return { ok: false, error: bounded };
    }
    maxTokens = Math.floor(bounded);
  }

  const request: FightRequest = { modelId, messages, inferenceConfig: { maxTokens } };
  if (system) {
    request.system = system;
  }

  const rawTemperature = inference.temperature ?? payload.temperature;
  if (rawTemperature !== undefined) {
    const bounded = boundedNumber(rawTemperature, "temperature", 0, 1);
    if (typeof bounded === "string") {
      return { ok: false, error: bounded };
    }
    request.inferenceConfig.temperature = bounded;
  }

  const rawTopP = inference.topP ?? payload.topP ?? payload.top_p;
  if (rawTopP !== undefined) {
    const bounded = boundedNumber(rawTopP, "topP", 0, 1);
    if (typeof bounded === "string") {
      return { ok: false, error: bounded };
    }
    request.inferenceConfig.topP = bounded;
  }

  const rawStop = inference.stopSequences ?? payload.stopSequences ?? payload.stop_sequences;
  if (rawStop !== undefined) {
    if (
      !Array.isArray(rawStop) ||
      rawStop.length > maxStopSequences ||
      rawStop.some((entry) => typeof entry !== "string" || entry === "")
    ) {
      return {
        ok: false,
        error: `stopSequences must be an array of at most ${maxStopSequences} non-empty strings`,
      };
    }
    request.inferenceConfig.stopSequences = rawStop as string[];
  }

  return { ok: true, request };
}

export type BedrockFailure = {
  status: 400 | 429 | 502 | 503 | 504;
  code: string;
  message: string;
  detail: string;
};

/**
 * Turn a bedrock-runtime error into something that says which knob to turn.
 *
 * These failures are indistinguishable to anyone who has not read the Bedrock
 * error catalogue — every one arrives as an exception name plus prose — and
 * collapsing all of them into "not configured" is what burns an afternoon. The
 * mapping is from responses observed live against bedrock-runtime, and it
 * deliberately matches internal/codereview/ai.go describeBedrockFailure so the
 * cloud leg and the local leg tell the user the same story:
 *
 *   denied model     AccessDeniedException        "<id> is not available for this account"
 *   bare model ID    ValidationException          "with on-demand throughput isn't supported"
 *   wrong region     ValidationException          "The provided model identifier is invalid."
 *   bad credentials  UnrecognizedClientException  "The security token ... is invalid"
 *   no credentials   CredentialsProviderError     "Could not load credentials from any providers"
 *   throttled        ThrottlingException          429
 *
 * Note a bare model ID is a ValidationException, not AccessDenied: the account
 * may use the model, it just cannot be reached that way.
 */
export function describeBedrockFailure(
  error: unknown,
  model: string,
  region: string,
): BedrockFailure {
  const name =
    (isRecord(error) && typeof error.name === "string" ? error.name : "") || "Error";
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();
  const httpStatus =
    isRecord(error) && isRecord(error.$metadata) && typeof error.$metadata.httpStatusCode === "number"
      ? error.$metadata.httpStatusCode
      : 0;

  if (name === "AbortError" || name === "TimeoutError" || lower.includes("aborted")) {
    return {
      status: 504,
      code: "bedrock_timeout",
      message: `Bedrock model ${model} in ${region} did not respond within ${requestTimeoutMs()}ms.`,
      detail,
    };
  }
  if (lower.includes("on-demand throughput") || lower.includes("inference profile")) {
    return {
      status: 400,
      code: "model_on_demand_unsupported",
      message: `Bedrock model "${model}" cannot be invoked on demand; use its "us."-prefixed inference profile ID instead.`,
      detail,
    };
  }
  if (lower.includes("not available for this account")) {
    return {
      status: 502,
      code: "model_access_denied",
      message: `Bedrock model "${model}" is not enabled for TX's AWS account in ${region}. Request access in the Bedrock console.`,
      detail,
    };
  }
  if (lower.includes("model identifier is invalid") || lower.includes("could not resolve the model")) {
    return {
      status: 502,
      code: "model_not_in_region",
      message: `Bedrock model "${model}" does not exist in region ${region}. Point AWS_REGION at a region where it is offered.`,
      detail,
    };
  }
  if (
    name === "CredentialsProviderError" ||
    lower.includes("could not load credentials") ||
    lower.includes("resolved credential object is not valid")
  ) {
    return {
      status: 503,
      code: "credentials_missing",
      message:
        "This server has no AWS credentials for Bedrock. Set AWS_PROFILE (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY), or attach a task role.",
      detail,
    };
  }
  if (
    name === "UnrecognizedClientException" ||
    lower.includes("security token") ||
    lower.includes("signature") ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return {
      status: 502,
      code: "credentials_invalid",
      message: `AWS rejected this server's Bedrock credentials for ${model} in ${region}. Check the key pair, and the session token if they are temporary.`,
      detail,
    };
  }
  if (name === "ThrottlingException" || httpStatus === 429 || lower.includes("throttl")) {
    return {
      status: 429,
      code: "bedrock_throttled",
      message: `Bedrock throttled ${model} in ${region}. Retry, or lower review concurrency.`,
      detail,
    };
  }
  if (name === "ValidationException" || httpStatus === 400) {
    return {
      status: 400,
      code: "bedrock_validation_error",
      message: `Bedrock rejected the request for ${model} in ${region}.`,
      detail,
    };
  }
  if (name === "ServiceQuotaExceededException") {
    return {
      status: 429,
      code: "bedrock_quota_exceeded",
      message: `Bedrock service quota exceeded for ${model} in ${region}.`,
      detail,
    };
  }
  return {
    status: 502,
    code: "bedrock_error",
    message: `Bedrock model ${model} in ${region} failed (${name}).`,
    detail,
  };
}

/** Converse output → the dual-shape body. */
export function fightResponseBody(
  modelId: string,
  response: ConverseCommandOutput,
): Record<string, unknown> {
  const blocks = response.output?.message?.content ?? [];
  const text = blocks
    .filter((block): block is ContentBlock.TextMember => typeof block.text === "string")
    .map((block) => block.text)
    .join("");

  return {
    model: modelId,
    // Anthropic InvokeModel-compatible mirror: the CLI parses this exact shape
    // when it calls Bedrock directly, so the cloud leg needs no second parser.
    content: text ? [{ type: "text", text }] : [],
    stop_reason: response.stopReason ?? null,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
      total_tokens: response.usage?.totalTokens ?? 0,
    },
    // Converse-native fields, verbatim.
    output: response.output ?? null,
    stopReason: response.stopReason ?? null,
    metrics: response.metrics ?? null,
  };
}

bedrockRoutes.post("/fight", async (c) => {
  const limit = maxRequestBytes();
  const declaredLength = Number(c.req.header("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    return c.json(
      {
        error: "payload_too_large",
        message: `Request body exceeds the ${limit} byte limit.`,
        limit_bytes: limit,
      },
      413,
    );
  }

  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > limit) {
    return c.json(
      {
        error: "payload_too_large",
        message: `Request body exceeds the ${limit} byte limit.`,
        limit_bytes: limit,
      },
      413,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return c.json({ error: "invalid_json", message: "Invalid JSON body" }, 400);
  }

  const normalized = normalizeFightRequest(payload);
  if (!normalized.ok) {
    return c.json({ error: "invalid_request", message: normalized.error }, 400);
  }
  const request = normalized.request;

  if (!isAllowedBedrockModel(request.modelId)) {
    return c.json(
      {
        error: "model_not_allowed",
        message: `Model "${request.modelId}" is not available through this endpoint.`,
        allowed_models: allowedBedrockModels(),
      },
      400,
    );
  }

  const region = awsRegion();
  if (!bedrockConfigured()) {
    return c.json(
      {
        error: "bedrock_not_configured",
        message:
          "This server has no AWS configuration for Bedrock. Set AWS_REGION plus AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.",
        region,
      },
      503,
    );
  }

  const startedAt = timingNow();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs());
  try {
    const response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: request.modelId,
        messages: request.messages,
        ...(request.system ? { system: request.system } : {}),
        inferenceConfig: request.inferenceConfig,
      }),
      { abortSignal: controller.signal },
    );
    logTiming("bedrock.fight", startedAt, {
      status: 200,
      model: request.modelId,
      region,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    });
    return c.json(fightResponseBody(request.modelId, response));
  } catch (error) {
    const failure = describeBedrockFailure(error, request.modelId, region);
    logTiming("bedrock.fight", startedAt, {
      status: failure.status,
      model: request.modelId,
      region,
      error: failure.code,
    });
    console.error("bedrock fight failed", {
      model: request.modelId,
      region,
      code: failure.code,
      detail: failure.detail,
    });
    return c.json(
      {
        error: failure.code,
        message: failure.message,
        detail: failure.detail,
        model: request.modelId,
        region,
      },
      failure.status,
    );
  } finally {
    clearTimeout(timeout);
  }
});
