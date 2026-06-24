import { afterEach, describe, expect, test } from "bun:test";
import { createLLMProvider, createMockProvider, createReviewProviders } from "../src/llm/provider";

const originalFetch = globalThis.fetch;
const originalEnv = {
  GX_OPENAI_API_KEY: process.env.GX_OPENAI_API_KEY,
  GX_OPENAI_BASE_URL: process.env.GX_OPENAI_BASE_URL,
  GX_REVIEW_OPENAI_MODEL: process.env.GX_REVIEW_OPENAI_MODEL,
  GX_REVIEW_MODELS: process.env.GX_REVIEW_MODELS,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  AWS_REGION: process.env.AWS_REGION,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("createLLMProvider", () => {
  test("uses the OpenAI Responses API", async () => {
    let requestedURL = "";
    let requestedBody: Record<string, unknown> = {};

    process.env.GX_OPENAI_API_KEY = "test-key";
    process.env.GX_OPENAI_BASE_URL = "https://api.openai.test";
    process.env.GX_REVIEW_OPENAI_MODEL = "test-model";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedURL = String(input);
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(init?.headers).toEqual({
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      });
      return new Response(JSON.stringify({ model: "test-model", output_text: "summary" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const provider = createLLMProvider();
    const result = await provider.complete("system prompt", "user prompt");

    expect(result).toEqual({ text: "summary", model: "test-model" });
    expect(requestedURL).toBe("https://api.openai.test/v1/responses");
    expect(requestedBody).toEqual({
      model: "test-model",
      instructions: "system prompt",
      input: "user prompt",
      max_output_tokens: 1200,
    });
  });
});

describe("createReviewProviders", () => {
  test("orders OpenAI before Anthropic when both are configured", () => {
    process.env.GX_OPENAI_API_KEY = "test-openai-key";
    process.env.AWS_REGION = "us-east-1";
    delete process.env.GX_REVIEW_MODELS;

    const providers = createReviewProviders();

    expect(providers.map((provider) => provider.label)).toEqual(["OpenAI", "Anthropic"]);
  });
});

describe("createMockProvider", () => {
  test("returns structured cited JSON for gx mention prompts with available sources", async () => {
    const provider = createMockProvider();
    const result = await provider.complete(
      "You are GX in a GitHub pull request comment thread.",
      "Available sources:\n[S1] published_revision: docs/documentation touched README.md",
    );

    expect(JSON.parse(result.text)).toEqual({
      answer: "Start with the changed runtime file and the test assertion it depends on. [S1]",
      citations: ["S1"],
    });
  });

  test("returns structured no-source JSON for gx mention prompts without sources", async () => {
    const provider = createMockProvider();
    const result = await provider.complete(
      "You are GX in a GitHub pull request comment thread.",
      "Available sources:\n(none)",
    );

    expect(JSON.parse(result.text)).toEqual({
      answer: "I couldn't answer from the available review context because no citeable sources were provided.",
      citations: [],
    });
  });
});
