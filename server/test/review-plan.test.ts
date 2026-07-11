import { describe, expect, test } from "bun:test";
import {
  normalizeModelId,
  pricingForModel,
  estimateCostUsd,
} from "../src/pricing/model-pricing";
import { splitUnifiedDiff, sliceFilePatch, newLineRanges } from "../src/review-plan/patch";
import { buildUsageBreakdown, parseUsageFromBody } from "../src/review-plan/usage";
import { parseAndValidateReviewPlan } from "../src/review-plan/validate";
import type { ReviewPlanContext } from "../src/review-plan/context";
import { createMockProvider } from "../src/llm/provider";
import { REVIEW_PLAN_SYSTEM_PROMPT } from "../src/llm/prompts/review-plan";
import fixture from "./fixtures/review-artifact.json";


describe("pricingForModel", () => {
  test("matches claude opus with bedrock prefix and date suffix", () => {
    const p = pricingForModel("us.anthropic.claude-opus-4-20250514-v1:0");
    expect(p).not.toBeNull();
    expect(p!.input).toBe(15);
  });

  test("matches gpt-5 family", () => {
    const p = pricingForModel("gpt-5.2");
    expect(p).not.toBeNull();
    expect(p!.input).toBe(1.25);
    expect(pricingForModel("GPT-5-mini")).not.toBeNull();
  });

  test("matches o-series", () => {
    expect(pricingForModel("o3-mini")).not.toBeNull();
  });

  test("returns null for unknown models", () => {
    expect(pricingForModel("totally-custom-model-xyz")).toBeNull();
  });

  test("normalizeModelId strips prefixes", () => {
    expect(normalizeModelId("bedrock:us.anthropic.claude-sonnet-4-20250514")).toContain(
      "claude-sonnet",
    );
  });

  test("estimateCostUsd computes from rates", () => {
    const cost = estimateCostUsd({
      modelId: "claude-sonnet-4",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cost).toBe(3);
  });
});

describe("buildUsageBreakdown", () => {
  test("aggregates per-response token columns by harness×model", () => {
    const usage = buildUsageBreakdown({
      agentProvenance: [
        {
          session_id: "s1",
          agent_tool: "codex",
          model_id: "gpt-5.2",
        },
        {
          session_id: "pseudo",
          agent_tool: "gx_commit",
          source: { task_summary: "do the thing" },
        },
      ],
      sessions: [
        {
          id: "s1",
          command: "codex",
          requests: [
            {
              model: "gpt-5.2",
              responses: [
                {
                  input_tokens: 1000,
                  output_tokens: 200,
                  cache_read_tokens: 100,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(usage.bySession).toHaveLength(1);
    expect(usage.bySession[0]!.harness).toBe("codex");
    expect(usage.totals.inputTokens).toBe(1000);
    expect(usage.totals.outputTokens).toBe(200);
    expect(usage.totals.cacheReadTokens).toBe(100);
    expect(usage.byHarness[0]!.costUsd).not.toBeNull();
  });

  test("aggregates fixture artifact including body-parse fallback", () => {
    const provenance =
      (fixture as { change?: { review_context?: { agent_provenance?: unknown[] } } })
        .change?.review_context?.agent_provenance ?? [];
    const usage = buildUsageBreakdown({
      sessions: (fixture as { sessions?: unknown }).sessions,
      agentProvenance: provenance,
    });
    expect(usage.bySession.length).toBeGreaterThanOrEqual(2);
    expect(usage.totals.inputTokens).toBeGreaterThan(0);
    expect(usage.totals.outputTokens).toBeGreaterThan(0);
    expect(usage.byHarness.some((h) => h.harness === "claude")).toBe(true);
    expect(usage.totals.costUsd).not.toBeNull();
  });

  test("falls back to parsing usage JSON from response_body", () => {
    const usage = buildUsageBreakdown({
      agentProvenance: [{ session_id: "s2", agent_tool: "claude", model_id: "claude-sonnet-4" }],
      sessions: [
        {
          id: "s2",
          requests: [
            {
              responses: [
                {
                  response_body: JSON.stringify({
                    usage: {
                      input_tokens: 500,
                      output_tokens: 50,
                      cache_read_input_tokens: 20,
                    },
                  }),
                },
              ],
            },
          ],
        },
      ],
    });
    expect(usage.totals.inputTokens).toBe(500);
    expect(usage.totals.outputTokens).toBe(50);
    expect(usage.totals.cacheReadTokens).toBe(20);
  });

  test("parseUsageFromBody handles embedded usage snippet", () => {
    const parsed = parseUsageFromBody('prefix "usage": {"input_tokens": 10, "output_tokens": 2} suffix');
    expect(parsed?.inputTokens).toBe(10);
    expect(parsed?.outputTokens).toBe(2);
  });

  test("uses command heuristic when provenance missing", () => {
    const usage = buildUsageBreakdown({
      sessions: [
        {
          id: "s3",
          command: "/usr/bin/claude --print",
          requests: [
            {
              model: "claude-haiku-4",
              responses: [{ input_tokens: 10, output_tokens: 1 }],
            },
          ],
        },
      ],
    });
    expect(usage.bySession[0]!.harness).toBe("claude");
  });
});

describe("splitUnifiedDiff", () => {
  const sample = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2b
+line2c
 line3
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,2 +10,3 @@
 keep
+added
`;

  test("splits into per-file patches", () => {
    const files = splitUnifiedDiff(sample);
    expect(files).toHaveLength(2);
    expect(files[0]!.file).toBe("src/a.ts");
    expect(files[1]!.file).toBe("src/b.ts");
    expect(newLineRanges(files[0]!)[0]).toEqual({ start: 1, end: 4 });
  });

  test("slices hunks by new-line range", () => {
    const files = splitUnifiedDiff(sample);
    const sliced = sliceFilePatch(files[1]!, 10, 12);
    expect(sliced).toContain("@@ -10,2 +10,3 @@");
    expect(sliced).toContain("+added");
  });
});

describe("parseAndValidateReviewPlan", () => {
  function stubCtx(files: string[]): ReviewPlanContext {
    const patch = files
      .map(
        (f) => `diff --git a/${f} b/${f}
--- a/${f}
+++ b/${f}
@@ -1,1 +1,2 @@
 keep
+added
`,
      )
      .join("");
    const filePatches = splitUnifiedDiff(patch);
    return {
      orgId: "org",
      bookmarkId: "bm",
      eventId: "ev",
      headCommitId: "abc",
      repoFullName: "acme/repo",
      branchName: "feat",
      baseBranch: "main",
      title: "Test",
      revisions: [
        {
          changeId: "r1",
          branchName: "feat",
          baseBranchName: "main",
          description: "test change",
          files,
          patch,
          filePatches,
          agentProvenance: [],
        },
      ],
      allFiles: files,
      cappedPatches: filePatches,
      intent: {
        selfReport: { taskSummary: "Ship the review page" },
        firstUserMessages: [],
        demuxIntents: [],
        descriptions: ["test change"],
      },
      hunkLinks: [],
      usage: {
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          costUsd: null,
          unpricedModels: 0,
        },
        byHarness: [],
        bySession: [],
        unknownModels: [],
      },
      risk: { level: "medium", score: 40, signals: [] },
    };
  }

  test("keeps valid anchors and fills safeToSkim", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const raw = JSON.stringify({
      schemaVersion: 1,
      narrative: {
        summary: "Ship the review page as planned.",
        summaryTeaser: "Ship the review page as planned.",
        why: "Humans need a focused review surface.",
        whyTeaser: "Humans need a focused review surface.",
        attributionSources: [{ source: "agent-sessions", pct: 100 }],
        selfReportQuote: "Ship the review page",
      },
      notableChanges: [
        {
          rank: 1,
          category: "architecture",
          title: "Core route",
          whyItMatters: "New review API shapes the product.",
          anchor: { file: "src/a.ts", lineStart: 1, lineEnd: 2 },
          anchorConfidence: "exact",
        },
        {
          rank: 2,
          category: "pattern",
          title: "UI card",
          whyItMatters: "Establishes the review card pattern.",
          anchor: { file: "src/b.ts", lineStart: 1, lineEnd: 2 },
          anchorConfidence: "exact",
        },
        {
          rank: 3,
          category: "blast-radius",
          title: "Shared util",
          whyItMatters: "Touched by many callers.",
          anchor: { file: "src/c.ts", lineStart: 99, lineEnd: 120 },
          anchorConfidence: "exact",
        },
      ],
      safeToSkim: [],
      revisions: [],
    });

    const result = parseAndValidateReviewPlan(raw, ctx);
    expect(result.ok).toBe(true);
    expect(result.plan!.notableChanges).toHaveLength(3);
    expect(result.plan!.narrative.summaryTeaser.length).toBeGreaterThan(0);
    expect(result.plan!.narrative.whyTeaser.length).toBeGreaterThan(0);
    // line range outside hunk → downgraded to file
    expect(result.plan!.notableChanges[2]!.anchorConfidence).toBe("file");
    expect(result.plan!.safeToSkim.length).toBeGreaterThanOrEqual(0);
  });

  test("fails when no surviving changes", () => {
    const ctx = stubCtx(["src/a.ts"]);
    const raw = JSON.stringify({
      narrative: { summary: "x", why: "y", attributionSources: [] },
      notableChanges: [
        {
          rank: 1,
          category: "architecture",
          title: "Missing",
          whyItMatters: "nope",
          anchor: { file: "does-not-exist.ts" },
        },
      ],
      safeToSkim: [],
    });
    const result = parseAndValidateReviewPlan(raw, ctx);
    expect(result.ok).toBe(false);
  });
});

describe("mock review-plan provider", () => {
  test("returns valid JSON for review-plan system prompt", async () => {
    const provider = createMockProvider("Build the review experience");
    const user = [
      "Repository: acme/repo",
      "## Revisions",
      "- r1 branch=feat files=2: src/a.ts, src/b.ts",
      "## Patches (capped)",
      "### src/a.ts",
      "diff --git a/src/a.ts b/src/a.ts",
      "### src/b.ts",
      "diff --git a/src/b.ts b/src/b.ts",
    ].join("\n");
    const completion = await provider.complete(REVIEW_PLAN_SYSTEM_PROMPT, user);
    const parsed = JSON.parse(completion.text);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.notableChanges.length).toBeGreaterThanOrEqual(3);
  });
});
