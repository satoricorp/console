import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { setBedrockClientForTesting } from "../src/llm/provider";
import {
  insertLLMUsage,
  openAIUsageFromResponseBody,
} from "../src/metering/llm-usage";
import { BEDROCK_FIGHT_MODELS } from "../src/routes/bedrock";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

// ---------------------------------------------------------------------------
// Pure parsing. The OpenAI proxy re-emits bytes it never previously looked at;
// these pin down exactly which bodies produce a metering row and which are
// silently (and deliberately) skipped.
// ---------------------------------------------------------------------------

describe("openAIUsageFromResponseBody", () => {
  test("parses the chat-completions usage shape", () => {
    const parsed = openAIUsageFromResponseBody(
      JSON.stringify({
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 20 },
        },
      }),
    );
    expect(parsed).toEqual({
      model: "gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20 },
    });
  });

  test("parses the responses-API usage shape", () => {
    const parsed = openAIUsageFromResponseBody(
      JSON.stringify({
        model: "gpt-5",
        usage: {
          input_tokens: 500,
          output_tokens: 80,
          total_tokens: 580,
          input_tokens_details: { cached_tokens: 0 },
        },
      }),
    );
    expect(parsed).toEqual({
      model: "gpt-5",
      usage: { inputTokens: 500, outputTokens: 80, cacheReadTokens: 0 },
    });
  });

  test("works without cached-token details", () => {
    const parsed = openAIUsageFromResponseBody(
      JSON.stringify({
        model: "gpt-4o",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
    expect(parsed).toEqual({
      model: "gpt-4o",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  test.each([
    ["a streaming SSE body", 'data: {"choices":[]}\n\ndata: [DONE]\n'],
    ["an error payload", JSON.stringify({ error: { message: "rate limited" } })],
    ["a body without usage", JSON.stringify({ model: "gpt-4o", choices: [] })],
    ["usage with non-numeric tokens", JSON.stringify({ model: "m", usage: { prompt_tokens: "x" } })],
    ["non-JSON", "<html>bad gateway</html>"],
  ])("returns null for %s", (_label, body) => {
    expect(openAIUsageFromResponseBody(body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Database rows: cost pricing and the fight-route wiring.
// ---------------------------------------------------------------------------

/** The metering write is fire-and-forget; give it a moment to land. */
async function waitForUsageRows(
  orgId: string,
  endpoint: string,
): Promise<Array<Record<string, unknown>>> {
  const db = getSql();
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const rows = await db<Array<Record<string, unknown>>>`
      SELECT * FROM llm_usage WHERE org_id = ${orgId}::uuid AND endpoint = ${endpoint}
    `;
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`metering write for ${endpoint} did not land within 5s`);
}

describeDb("llm_usage metering", () => {
  let orgId: string;
  const originalRegion = process.env.AWS_REGION;
  const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;

  beforeAll(async () => {
    installTestAuth();
    process.env.AWS_REGION = process.env.AWS_REGION || "us-west-2";
    // Keep the quota gate on the org-trial path instead of Convex entitlement.
    delete process.env.CONVEX_SITE_URL;
    await runMigrations();
    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    orgId = org.id;
  });

  afterAll(() => {
    setBedrockClientForTesting(null);
    if (originalRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalRegion;
    if (originalConvexSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
  });

  test("insertLLMUsage prices known models and leaves unknown ones NULL", async () => {
    const db = getSql();
    await insertLLMUsage(db, {
      orgId,
      userId: "user-1",
      sessionId: "sess-1",
      machineId: "machine-1",
      surface: "cli",
      endpoint: "unit.priced",
      model: "us.anthropic.claude-sonnet-4-6",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    await insertLLMUsage(db, {
      orgId,
      userId: "user-1",
      endpoint: "unit.unpriced",
      model: "totally-unknown-model",
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const [priced] = await db<{ cost_usd: number | null; session_id: string | null }[]>`
      SELECT cost_usd, session_id FROM llm_usage
      WHERE org_id = ${orgId}::uuid AND endpoint = 'unit.priced'
    `;
    // Sonnet list price: $3/M input + $15/M output.
    expect(Number(priced.cost_usd)).toBeCloseTo(18, 6);
    expect(priced.session_id).toBe("sess-1");

    const [unpriced] = await db<{ cost_usd: number | null }[]>`
      SELECT cost_usd FROM llm_usage
      WHERE org_id = ${orgId}::uuid AND endpoint = 'unit.unpriced'
    `;
    expect(unpriced.cost_usd).toBeNull();
  });

  test("POST /gx/bedrock/fight records a usage row for the caller", async () => {
    setBedrockClientForTesting({
      send: async () => ({
        output: { message: { role: "assistant", content: [{ text: "ok" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 1234, outputTokens: 56, totalTokens: 1290 },
      }),
    } as unknown as BedrockRuntimeClient);

    const response = await app.request("/gx/bedrock/fight", {
      method: "POST",
      headers: {
        ...authHeaders("fight-user", orgId),
        "Content-Type": "application/json",
        "X-GX-Client": "cli",
      },
      body: JSON.stringify({
        model: BEDROCK_FIGHT_MODELS[0],
        max_tokens: 64,
        messages: [{ role: "user", content: "say ok" }],
      }),
    });
    expect(response.status).toBe(200);

    const rows = await waitForUsageRows(orgId, "bedrock.fight");
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.user_id).toBe("fight-user");
    expect(row.model).toBe(BEDROCK_FIGHT_MODELS[0]);
    expect(row.surface).toBe("cli");
    expect(Number(row.input_tokens)).toBe(1234);
    expect(Number(row.output_tokens)).toBe(56);
    expect(row.cost_usd).not.toBeNull();
  });
});
