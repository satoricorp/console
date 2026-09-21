import { afterEach, describe, expect, test } from "bun:test";
import { describeRouteError } from "../src/app";
import type { IndexingConfig } from "../src/indexing/config";
import { countTokens } from "../src/indexing/tokenClamp";
import { embedTexts, resetIndexingFetch, setIndexingFetch } from "../src/indexing/turbopuffer";

/**
 * OpenAI rejects an embedding input over 8192 tokens with a 400 that fails the
 * whole batch. Production hit it through the search path — a review sends its
 * diff as the query — which 500ed /v1/code-review-history/search and dropped
 * the "prior review findings" evidence source from every large review.
 */

const cfg: IndexingConfig = {
  openAIAPIKey: "test-openai",
  turboPufferAPIKey: "test-tpuf",
  openAIBaseURL: "https://openai.test/v1",
  turboPufferBaseURL: "https://tpuf.test",
};

/** OpenAI's hard limit. Everything sent must land under it. */
const API_LIMIT_TOKENS = 8192;

function captureEmbeddingInputs(captured: string[][]) {
  setIndexingFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/embeddings")) {
      throw new Error(`unexpected request: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    captured.push(body.input ?? []);
    return new Response(
      JSON.stringify({
        data: (body.input ?? []).map((_, index) => ({
          index,
          embedding: Array.from({ length: 1536 }, () => 0.01),
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch);
}

afterEach(() => {
  resetIndexingFetch();
});

describe("embedTexts token clamp", () => {
  test("clamps an oversized input under the API limit", async () => {
    const captured: string[][] = [];
    captureEmbeddingInputs(captured);

    // A diff-shaped query far past the limit. Deliberately dense: no spaces to
    // merge on, so it tokenizes near one token per few characters rather than
    // the ~4 that English prose gets.
    const huge = "diff --git a/x.ts b/x.ts\n+const x=1;".repeat(4000);
    expect(countTokens(huge)).toBeGreaterThan(API_LIMIT_TOKENS);

    await embedTexts(cfg, [huge]);

    expect(captured).toHaveLength(1);
    const sent = captured[0]![0]!;
    expect(countTokens(sent)).toBeLessThanOrEqual(API_LIMIT_TOKENS);
    // A prefix of the original, not a re-encoded or reordered version of it.
    expect(huge.startsWith(sent.slice(0, sent.length - 1))).toBe(true);
  });

  test("leaves an ordinary input untouched", async () => {
    const captured: string[][] = [];
    captureEmbeddingInputs(captured);

    const query = "why does the keyring write fail on headless linux";
    await embedTexts(cfg, [query]);

    expect(captured[0]).toEqual([query]);
  });

  test("clamps every input in a batch, not just the first", async () => {
    const captured: string[][] = [];
    captureEmbeddingInputs(captured);

    // The indexing callers batch 64 chunks per request, and one oversized
    // chunk 400s the entire batch — so the short chunks beside it fail too.
    // Reuse the dense diff-shaped string from the single-input case: it blows
    // past the API limit with far fewer characters than a space-free run of
    // "x", so CI stays under Bun's default 5s timeout on shared runners.
    const huge = "diff --git a/x.ts b/x.ts\n+const x=1;".repeat(2000);
    expect(countTokens(huge)).toBeGreaterThan(API_LIMIT_TOKENS);
    await embedTexts(cfg, ["short one", huge, "short two"]);

    const sent = captured[0]!;
    expect(sent).toHaveLength(3);
    for (const input of sent) {
      expect(countTokens(input)).toBeLessThanOrEqual(API_LIMIT_TOKENS);
    }
    expect(sent[0]).toBe("short one");
    expect(sent[2]).toBe("short two");
  });
});

describe("route error shaping", () => {
  test("names the embedding limit rather than reporting nothing", () => {
    const described = describeRouteError(
      new Error(
        `request OpenAI embeddings: status 400 {"error":{"message":"Invalid 'input[0]': maximum input length is 8192 tokens."}}`,
      ),
    );
    expect(described.code).toBe("embedding_input_too_large");
    expect(described.errorId).toMatch(/^[0-9a-f]{8}$/);
  });

  test("falls back to a generic code but still issues an id", () => {
    const described = describeRouteError(new Error("something nobody has seen before"));
    expect(described.code).toBe("internal_error");
    expect(described.errorId).toMatch(/^[0-9a-f]{8}$/);
  });

  test("gives each failure its own id", () => {
    const a = describeRouteError(new Error("boom"));
    const b = describeRouteError(new Error("boom"));
    expect(a.errorId).not.toBe(b.errorId);
  });
});
