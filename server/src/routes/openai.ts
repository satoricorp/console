import { Hono } from "hono";
import type { Context } from "hono";
import { getSql } from "../db";
import {
  openAIUsageFromResponseBody,
  recordLLMUsage,
} from "../metering/llm-usage";
import {
  checkCloudAIQuota,
  paymentRequiredBody,
  TrialEntitlementUnavailableError,
} from "../metering/quota";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { logTiming, timingNow } from "../timing";

export const openAIRoutes = new Hono<AppEnv>();

openAIRoutes.use("*", requireAuth);

// Cloud AI is a paid feature with a free-run allowance. Every call reserves
// under the CLI's run key (X-GX-Run), so one `gx review` costs one run however
// many model calls it makes; once the runs are spent, a clean 402 carries the
// checkout URL instead of burning tokens on the shared key.
openAIRoutes.use("*", async (c, next) => {
  const auth = c.get("auth");
  let quota;
  try {
    quota = await checkCloudAIQuota(
      getSql(),
      auth.orgId,
      auth.userId,
      c.req.header("X-GX-Run"),
    );
  } catch (error) {
    if (error instanceof TrialEntitlementUnavailableError) {
      return c.json(
        {
          error: "entitlement_unavailable",
          message: "gx entitlement service is unavailable. Please retry.",
        },
        503,
      );
    }
    throw error;
  }
  if (!quota.allowed) {
    return c.json(paymentRequiredBody(quota), 402);
  }
  await next();
});

const defaultOpenAIBaseURL = "https://api.openai.com/v1";
const defaultOpenAITimeoutMs = 300_000;

function openAIBaseURL(): string {
  const raw =
    process.env.GX_CLOUD_OPENAI_BASE_URL?.trim() ||
    process.env.GX_OPENAI_BASE_URL?.trim() ||
    defaultOpenAIBaseURL;
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function openAIAPIKey(): string {
  return process.env.GX_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
}

function openAITimeoutMs(): number {
  const raw = process.env.GX_CLOUD_OPENAI_TIMEOUT_MS?.trim();
  if (!raw) return defaultOpenAITimeoutMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultOpenAITimeoutMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validChatCompletionPayload(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.model !== "string" || value.model.trim() === "") return false;
  if (!Array.isArray(value.messages) || value.messages.length === 0) return false;
  return value.messages.every((message) => {
    if (!isRecord(message)) return false;
    if (typeof message.role !== "string") return false;
    return typeof message.content === "string" || Array.isArray(message.content);
  });
}

function validResponsesPayload(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.model !== "string" || value.model.trim() === "") return false;
  if (!("input" in value)) return false;
  if ("instructions" in value && typeof value.instructions !== "string") return false;
  return typeof value.input === "string" || Array.isArray(value.input);
}

async function postOpenAI(path: string, payload: Record<string, unknown>): Promise<Response> {
  const startedAt = timingNow();
  const body = JSON.stringify(payload);
  const timeoutMs = openAITimeoutMs();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${openAIBaseURL()}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAIAPIKey()}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      logTiming(`openai.${path.replaceAll("/", ".")}`, startedAt, {
        status: response.status,
        model: typeof payload.model === "string" ? payload.model : "",
        attempt: attempt + 1,
      });
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  logTiming(`openai.${path.replaceAll("/", ".")}`, startedAt, {
    status: "error",
    error: message,
  });
  return Response.json(
    {
      error: "OpenAI request failed",
      detail: message,
    },
    { status: 502 },
  );
}

async function proxyOpenAIResponse(
  c: Context<AppEnv>,
  endpoint: string,
  response: Response,
): Promise<Response> {
  const body = await response.text();
  // Best-effort metering before the bytes go back out. Streaming (SSE) bodies
  // and error payloads parse to null and record nothing; a metering failure
  // never fails the proxy request (recordLLMUsage is fire-and-forget).
  if (response.ok) {
    const parsed = openAIUsageFromResponseBody(body);
    if (parsed) {
      const auth = c.get("auth");
      recordLLMUsage(getSql(), {
        orgId: auth.orgId,
        userId: auth.userId,
        sessionId: auth.sessionId ?? null,
        machineId: auth.machineId ?? null,
        surface: c.req.header("X-GX-Client") ?? null,
        endpoint,
        model: parsed.model,
        usage: parsed.usage,
      });
    }
  }
  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

openAIRoutes.post("/chat-completions", async (c) => {
  if (!openAIAPIKey()) {
    return c.json({ error: "OpenAI is not configured" }, 503);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!validChatCompletionPayload(payload)) {
    return c.json({ error: "Invalid chat completion payload" }, 400);
  }

  return proxyOpenAIResponse(
    c,
    "openai.chat-completions",
    await postOpenAI("/chat/completions", payload),
  );
});

openAIRoutes.post("/responses", async (c) => {
  if (!openAIAPIKey()) {
    return c.json({ error: "OpenAI is not configured" }, 503);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!validResponsesPayload(payload)) {
    return c.json({ error: "Invalid responses payload" }, 400);
  }

  return proxyOpenAIResponse(
    c,
    "openai.responses",
    await postOpenAI("/responses", payload),
  );
});
