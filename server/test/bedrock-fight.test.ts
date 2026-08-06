import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { setBedrockClientForTesting } from "../src/llm/provider";
import { BASE_TRIAL_DAYS, MS_PER_DAY } from "../src/metering/quota";
import {
  BEDROCK_FIGHT_MODELS,
  describeBedrockFailure,
  fightResponseBody,
  isAllowedBedrockModel,
  normalizeFightRequest,
} from "../src/routes/bedrock";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

const reviewerA = BEDROCK_FIGHT_MODELS[0];

type FakeSend = (input: Record<string, unknown>) => Promise<unknown>;

function fakeBedrock(send: FakeSend): BedrockRuntimeClient {
  return {
    send: async (command: { input: Record<string, unknown> }) => send(command.input),
  } as unknown as BedrockRuntimeClient;
}

function converseSuccess(text: string) {
  return {
    output: { message: { role: "assistant", content: [{ text }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    metrics: { latencyMs: 42 },
  };
}

function awsError(name: string, message: string, httpStatusCode: number): Error {
  const error = new Error(message);
  error.name = name;
  (error as Error & { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode };
  return error;
}

// ---------------------------------------------------------------------------
// Pure request/response contract. These must run without a database, because
// the allowlist is the thing standing between an authenticated caller and gx's
// Bedrock bill — it cannot be a test that silently skips on a laptop.
// ---------------------------------------------------------------------------

describe("bedrock fight allowlist", () => {
  test("accepts each configured fight model", () => {
    for (const model of BEDROCK_FIGHT_MODELS) {
      expect(isAllowedBedrockModel(model)).toBe(true);
    }
  });

  test("rejects models that are not configured", () => {
    expect(isAllowedBedrockModel("us.anthropic.claude-3-haiku-20240307-v1:0")).toBe(false);
    expect(isAllowedBedrockModel("us.amazon.nova-premier-v1:0")).toBe(false);
    expect(isAllowedBedrockModel("arn:aws:bedrock:us-west-2:1:provisioned-model/x")).toBe(false);
  });

  test("rejects the bare form of an allowed model", () => {
    expect(isAllowedBedrockModel("anthropic.claude-sonnet-4-6")).toBe(false);
  });
});

describe("normalizeFightRequest", () => {
  test("accepts the Anthropic messages shape the CLI already builds", () => {
    const result = normalizeFightRequest({
      anthropic_version: "bedrock-2023-05-31",
      model: reviewerA,
      max_tokens: 6000,
      system: "you are a reviewer",
      messages: [{ role: "user", content: "review this" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.modelId).toBe(reviewerA);
    expect(result.request.system).toEqual([{ text: "you are a reviewer" }]);
    expect(result.request.messages).toEqual([{ role: "user", content: [{ text: "review this" }] }]);
    expect(result.request.inferenceConfig.maxTokens).toBe(6000);
  });

  test("accepts the Converse shape", () => {
    const result = normalizeFightRequest({
      modelId: reviewerA,
      system: [{ text: "sys" }],
      messages: [{ role: "user", content: [{ text: "hi" }] }],
      inferenceConfig: { maxTokens: 100, temperature: 0, topP: 0.9, stopSequences: ["</end>"] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.inferenceConfig).toEqual({
      maxTokens: 100,
      temperature: 0,
      topP: 0.9,
      stopSequences: ["</end>"],
    });
  });

  test("defaults maxTokens rather than leaving it unset", () => {
    const result = normalizeFightRequest({
      model: reviewerA,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.inferenceConfig.maxTokens).toBe(4096);
  });

  test("rejects an unsupported field instead of silently ignoring it", () => {
    const result = normalizeFightRequest({
      model: reviewerA,
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 9000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("maxTokens");
  });

  test("rejects an output budget above the ceiling", () => {
    const result = normalizeFightRequest({
      model: reviewerA,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 500_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("32000");
  });

  test.each([
    ["no model", { messages: [{ role: "user", content: "hi" }] }],
    ["no messages", { model: reviewerA }],
    ["empty messages", { model: reviewerA, messages: [] }],
    ["system role in messages", { model: reviewerA, messages: [{ role: "system", content: "x" }] }],
    ["empty content", { model: reviewerA, messages: [{ role: "user", content: "" }] }],
    ["non-object body", "hello"],
  ])("rejects %s", (_label, payload) => {
    expect(normalizeFightRequest(payload).ok).toBe(false);
  });
});

describe("describeBedrockFailure", () => {
  test("a denied model is not reported as missing credentials", () => {
    const failure = describeBedrockFailure(
      awsError(
        "AccessDeniedException",
        "You don't have access to the model with the specified model ID: it is not available for this account.",
        403,
      ),
      reviewerA,
      "us-west-2",
    );
    expect(failure.code).toBe("model_access_denied");
    expect(failure.status).toBe(502);
  });

  test("a bare model ID reads as an inference-profile problem, not access", () => {
    const failure = describeBedrockFailure(
      awsError(
        "ValidationException",
        "Invocation of model ID anthropic.claude-sonnet-4-6 with on-demand throughput isn't supported.",
        400,
      ),
      "anthropic.claude-sonnet-4-6",
      "us-west-2",
    );
    expect(failure.code).toBe("model_on_demand_unsupported");
    expect(failure.status).toBe(400);
  });

  test("a wrong region reads as a region problem, not a bad model name", () => {
    const failure = describeBedrockFailure(
      awsError("ValidationException", "The provided model identifier is invalid.", 400),
      reviewerA,
      "eu-central-1",
    );
    expect(failure.code).toBe("model_not_in_region");
    expect(failure.message).toContain("eu-central-1");
  });

  test("missing and invalid credentials are different codes", () => {
    expect(
      describeBedrockFailure(
        awsError("CredentialsProviderError", "Could not load credentials from any providers", 0),
        reviewerA,
        "us-west-2",
      ).code,
    ).toBe("credentials_missing");

    expect(
      describeBedrockFailure(
        awsError("UnrecognizedClientException", "The security token included in the request is invalid.", 403),
        reviewerA,
        "us-west-2",
      ).code,
    ).toBe("credentials_invalid");
  });

  test("throttling is a 429, a timeout is a 504", () => {
    expect(
      describeBedrockFailure(awsError("ThrottlingException", "Too many requests", 429), reviewerA, "us-west-2").status,
    ).toBe(429);
    expect(
      describeBedrockFailure(awsError("AbortError", "The operation was aborted", 0), reviewerA, "us-west-2").status,
    ).toBe(504);
  });
});

describe("fightResponseBody", () => {
  test("answers in both the Anthropic and Converse shapes", () => {
    const body = fightResponseBody(reviewerA, converseSuccess("hello") as never);
    expect(body.content).toEqual([{ type: "text", text: "hello" }]);
    expect(body.stop_reason).toBe("end_turn");
    expect(body.usage).toEqual({ input_tokens: 12, output_tokens: 3, total_tokens: 15 });
    expect(body.output).toEqual({ message: { role: "assistant", content: [{ text: "hello" }] } });
    expect(body.model).toBe(reviewerA);
  });
});

// ---------------------------------------------------------------------------
// Route level. The quota gate reads the database, so these need one.
// ---------------------------------------------------------------------------

describeDb("POST /gx/bedrock/fight", () => {
  let orgId: string;
  let expiredOrgId: string;
  const originalRegion = process.env.AWS_REGION;
  const originalMaxBody = process.env.GX_CLOUD_BEDROCK_MAX_BODY_BYTES;

  const validBody = {
    model: reviewerA,
    max_tokens: 64,
    system: "be brief",
    messages: [{ role: "user", content: "say ok" }],
  };

  beforeAll(async () => {
    installTestAuth();
    process.env.AWS_REGION = process.env.AWS_REGION || "us-west-2";
    await runMigrations();

    const db = getSql();
    const now = Date.now();
    const [freshOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${now}) RETURNING id
    `;
    orgId = freshOrg.id;

    const [staleOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now - (BASE_TRIAL_DAYS + 1) * MS_PER_DAY})
      RETURNING id
    `;
    expiredOrgId = staleOrg.id;
  });

  afterAll(async () => {
    setBedrockClientForTesting(null);
    if (originalRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalRegion;
    if (originalMaxBody === undefined) delete process.env.GX_CLOUD_BEDROCK_MAX_BODY_BYTES;
    else process.env.GX_CLOUD_BEDROCK_MAX_BODY_BYTES = originalMaxBody;
  });

  function post(body: unknown, headers: Record<string, string> = authHeaders("local-user", orgId)) {
    return app.request("/gx/bedrock/fight", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  test("requires authentication", async () => {
    const response = await app.request("/gx/bedrock/fight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(response.status).toBe(401);
  });

  test("rejects an off-allowlist model with the allowed set", async () => {
    setBedrockClientForTesting(
      fakeBedrock(async () => {
        throw new Error("Bedrock must not be called for a rejected model");
      }),
    );

    const response = await post({ ...validBody, model: "us.anthropic.claude-3-haiku-20240307-v1:0" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; allowed_models: string[] };
    expect(body.error).toBe("model_not_allowed");
    expect(body.allowed_models).toContain(reviewerA);
  });

  test("rejects an oversized body", async () => {
    process.env.GX_CLOUD_BEDROCK_MAX_BODY_BYTES = "1024";
    try {
      const response = await post({
        ...validBody,
        messages: [{ role: "user", content: "x".repeat(4096) }],
      });
      expect(response.status).toBe(413);
      const body = (await response.json()) as { error: string; limit_bytes: number };
      expect(body.error).toBe("payload_too_large");
      expect(body.limit_bytes).toBe(1024);
    } finally {
      if (originalMaxBody === undefined) delete process.env.GX_CLOUD_BEDROCK_MAX_BODY_BYTES;
      else process.env.GX_CLOUD_BEDROCK_MAX_BODY_BYTES = originalMaxBody;
    }
  });

  test("rejects invalid JSON", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_json");
  });

  test("proxies a successful Converse call", async () => {
    let seen: Record<string, unknown> = {};
    setBedrockClientForTesting(
      fakeBedrock(async (input) => {
        seen = input;
        return converseSuccess("ok");
      }),
    );

    const response = await post(validBody);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(seen.modelId).toBe(reviewerA);
    expect(seen.system).toEqual([{ text: "be brief" }]);
    expect(seen.messages).toEqual([{ role: "user", content: [{ text: "say ok" }] }]);
    expect(seen.inferenceConfig).toEqual({ maxTokens: 64 });
    expect(body.content).toEqual([{ type: "text", text: "ok" }]);
    expect(body.model).toBe(reviewerA);
    expect(body.usage).toEqual({ input_tokens: 12, output_tokens: 3, total_tokens: 15 });
  });

  test("surfaces a denied model as model_access_denied, not 'not configured'", async () => {
    setBedrockClientForTesting(
      fakeBedrock(async () => {
        throw awsError(
          "AccessDeniedException",
          "The model us.anthropic.claude-opus-4-6-v1 is not available for this account.",
          403,
        );
      }),
    );

    const response = await post(validBody);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string; model: string; region: string };
    expect(body.error).toBe("model_access_denied");
    expect(body.model).toBe(reviewerA);
    expect(body.region).toBeTruthy();
  });

  test("past-trial free org gets the same 402 as /gx/openai", async () => {
    const response = await post(validBody, authHeaders("local-user", expiredOrgId));
    expect(response.status).toBe(402);
    expect(((await response.json()) as { error: string }).error).toBe("payment_required");
  });

  // Live leg. Off by default: it spends real Bedrock tokens on gx's account.
  //   GX_TEST_LIVE_BEDROCK=1 bun run test:db -- test/bedrock-fight.test.ts
  const live = process.env.GX_TEST_LIVE_BEDROCK === "1";
  (live ? test : test.skip)("calls Bedrock for real through the route", async () => {
    setBedrockClientForTesting(null); // rebuild a real client from the ambient AWS config
    const response = await post(validBody);
    const body = (await response.json()) as {
      content?: Array<{ text: string }>;
      usage?: { output_tokens: number };
    };
    expect(response.status).toBe(200);
    expect(body.content?.[0]?.text?.length ?? 0).toBeGreaterThan(0);
    expect(body.usage?.output_tokens ?? 0).toBeGreaterThan(0);
  }, 120_000);
});
