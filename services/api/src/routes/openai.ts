import { Hono } from "hono";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

export const openAIRoutes = new Hono<AppEnv>();

openAIRoutes.use("*", requireAuth);

const defaultOpenAIBaseURL = "https://api.openai.com/v1";
const defaultOpenAITimeoutMs = 180_000;

function openAIBaseURL(): string {
  const raw =
    process.env.GX_CLOUD_OPENAI_BASE_URL?.trim() ||
    process.env.GX_OPENAI_BASE_URL?.trim() ||
    defaultOpenAIBaseURL;
  return raw.replace(/\/+$/, "").endsWith("/v1")
    ? raw.replace(/\/+$/, "")
    : `${raw.replace(/\/+$/, "")}/v1`;
}

function openAIAPIKey(): string {
  return (
    process.env.GX_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
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

async function postOpenAIChatCompletions(payload: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(payload);
  const timeoutMs = openAITimeoutMs();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${openAIBaseURL()}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAIAPIKey()}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
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
  return Response.json(
    {
      error: "OpenAI request failed",
      detail: message,
    },
    { status: 502 },
  );
}

openAIRoutes.post("/chat-completions", async (c) => {
  const apiKey = openAIAPIKey();
  if (!apiKey) {
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

  const response = await postOpenAIChatCompletions(payload);

  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
});
