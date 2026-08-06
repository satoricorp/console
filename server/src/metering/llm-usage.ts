import type postgres from "postgres";
import { estimateCostUsd } from "../pricing/model-pricing";

export type LLMTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type LLMUsageRecord = {
  orgId: string;
  userId: string;
  sessionId?: string | null;
  machineId?: string | null;
  surface?: string | null;
  endpoint: string;
  model: string;
  usage: LLMTokenUsage;
};

function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/** Awaitable insert, for tests and callers that want the error. */
export async function insertLLMUsage(
  db: postgres.Sql,
  record: LLMUsageRecord,
): Promise<void> {
  const inputTokens = tokenCount(record.usage.inputTokens);
  const outputTokens = tokenCount(record.usage.outputTokens);
  const cacheReadTokens =
    record.usage.cacheReadTokens === undefined
      ? null
      : tokenCount(record.usage.cacheReadTokens);
  const cacheWriteTokens =
    record.usage.cacheWriteTokens === undefined
      ? null
      : tokenCount(record.usage.cacheWriteTokens);

  const costUsd = estimateCostUsd({
    modelId: record.model,
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
  });

  await db`
    INSERT INTO llm_usage (
      org_id, user_id, session_id, machine_id, surface,
      endpoint, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cost_usd, created_at_ms
    ) VALUES (
      ${record.orgId}::uuid,
      ${record.userId},
      ${record.sessionId ?? null},
      ${record.machineId ?? null},
      ${record.surface ?? null},
      ${record.endpoint},
      ${record.model},
      ${inputTokens},
      ${outputTokens},
      ${cacheReadTokens},
      ${cacheWriteTokens},
      ${costUsd},
      ${Date.now()}
    )
  `;
}

/**
 * Fire-and-forget metering write. A failure here must never fail the request
 * that spent the tokens, so the promise is detached and errors only logged.
 */
export function recordLLMUsage(db: postgres.Sql, record: LLMUsageRecord): void {
  void insertLLMUsage(db, record).catch((error) => {
    console.error("llm usage metering failed", {
      endpoint: record.endpoint,
      model: record.model,
      orgId: record.orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Pull `{model, usage}` out of an OpenAI response body the proxy is about to
 * re-emit. Understands both the chat-completions shape
 * (`prompt_tokens`/`completion_tokens`, cached tokens under
 * `prompt_tokens_details.cached_tokens`) and the responses-API shape
 * (`input_tokens`/`output_tokens`, cached tokens under
 * `input_tokens_details.cached_tokens`).
 *
 * Returns null for anything else — error payloads, or streaming (SSE) bodies,
 * which are not one JSON document. Metering is best-effort: an unparseable
 * body records nothing rather than guessing.
 */
export function openAIUsageFromResponseBody(
  body: string,
): { model: string; usage: LLMTokenUsage } | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(json) || typeof json.model !== "string" || !isRecord(json.usage)) {
    return null;
  }
  const usage = json.usage;

  const inputTokens = finiteNumber(usage.input_tokens) ?? finiteNumber(usage.prompt_tokens);
  const outputTokens =
    finiteNumber(usage.output_tokens) ?? finiteNumber(usage.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return null;
  }

  const details = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : null;
  const cachedTokens = details ? finiteNumber(details.cached_tokens) : undefined;

  return {
    model: json.model,
    usage: {
      // OpenAI's input_tokens/prompt_tokens already include the cached tokens;
      // subtract so cache reads are not double-billed at the full input rate.
      inputTokens: Math.max(0, inputTokens - (cachedTokens ?? 0)),
      outputTokens,
      ...(cachedTokens !== undefined ? { cacheReadTokens: cachedTokens } : {}),
    },
  };
}
