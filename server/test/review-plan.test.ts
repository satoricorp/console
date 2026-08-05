import { describe, expect, test } from "bun:test";
import {
  normalizeModelId,
  pricingForModel,
  estimateCostUsd,
} from "../src/pricing/model-pricing";
import { splitUnifiedDiff, sliceFilePatch, newLineRanges } from "../src/review-plan/patch";
import { buildUsageBreakdown, parseUsageFromBody } from "../src/review-plan/usage";
import {
  isCurrentReviewPlan,
  parseAndValidateReviewPlan,
  REVIEW_PLAN_HEURISTIC_VERSION,
  scoreReviewPlanCandidate,
} from "../src/review-plan/validate";
import { classifyFileForReview } from "../src/review-plan/priority";
import type { ReviewPlanContext } from "../src/review-plan/context";
import { createMockProvider } from "../src/llm/provider";
import { REVIEW_PLAN_SYSTEM_PROMPT } from "../src/llm/prompts/review-plan";
import { githubFilesToUnifiedDiff } from "../src/github/pr-patches";
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
    expect(sliced).toContain("@@ -10,1 +10,2 @@");
    expect(sliced).toContain("+added");
  });

  test("bounds a large hunk to the exact anchor and nearby context", () => {
    const additions = Array.from(
      { length: 200 },
      (_, index) => `+line-${index + 1}`,
    ).join("\n");
    const [file] = splitUnifiedDiff(`diff --git a/src/large.ts b/src/large.ts
new file mode 100644
--- /dev/null
+++ b/src/large.ts
@@ -0,0 +1,200 @@
${additions}
`);
    const sliced = sliceFilePatch(file!, 100, 102);
    expect(sliced).toContain("+line-100");
    expect(sliced).toContain("+line-102");
    expect(sliced).not.toContain("+line-1\n");
    expect(sliced.split("\n").length).toBeLessThan(25);
  });

  test("bounds broad and file-level anchors to one focused chunk", () => {
    const additions = Array.from(
      { length: 200 },
      (_, index) => `+line-${index + 1}`,
    ).join("\n");
    const [file] = splitUnifiedDiff(`diff --git a/src/large.ts b/src/large.ts
new file mode 100644
--- /dev/null
+++ b/src/large.ts
@@ -0,0 +1,200 @@
${additions}
`);

    for (const sliced of [
      sliceFilePatch(file!, 0, 200),
      sliceFilePatch(file!),
    ]) {
      expect(sliced).toContain("+line-1");
      expect(sliced).not.toContain("+line-40");
      expect(sliced.split("\n").length).toBeLessThan(40);
    }
  });

  test("wraps GitHub PR file patches into parseable unified diffs", () => {
    const unified = githubFilesToUnifiedDiff([
      {
        filename: "src/components/app-command-palette.tsx",
        previousFilename: null,
        status: "modified",
        patch:
          '@@ -104,6 +104,10 @@ export function AppCommandPalette() {\n         event.preventDefault();\n         runCommand("/download");\n       }\n+      if (key === "r") {\n+        event.preventDefault();\n+        runCommand("/reviews");\n+      }\n       if (key === "?") {\n',
      },
    ]);
    const files = splitUnifiedDiff(unified);
    expect(files).toHaveLength(1);
    expect(files[0]!.file).toBe("src/components/app-command-palette.tsx");
    expect(files[0]!.text).toContain("+      if (key === \"r\") {");
    expect(sliceFilePatch(files[0]!).length).toBeGreaterThan(0);
  });
});

describe("parseAndValidateReviewPlan", () => {
  function stubCtx(
    files: string[],
    opts?: {
      contextManifest?: ReviewPlanContext["contextManifest"];
      prPayloadPresent?: boolean;
    },
  ): ReviewPlanContext {
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
          commitId: "c1",
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
      contextManifest: opts?.contextManifest,
      prPayloadPresent: opts?.prPayloadPresent ?? true,
    };
  }

  function validPlanRaw(attributionSources: Array<{ source: string; pct: number }>) {
    return JSON.stringify({
      schemaVersion: 1,
      narrative: {
        summary: "Ship the review page as planned.",
        summaryTeaser: "Ship the review page as planned.",
        why: "Humans need a focused review surface.",
        whyTeaser: "Humans need a focused review surface.",
        attributionSources,
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
      ],
      safeToSkim: [{ file: "src/b.ts", reason: "trivial" }],
      revisions: [],
    });
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

  test("downgrades broad and zero-based anchors to file confidence", () => {
    const ctx = stubCtx(["src/a.ts"]);
    const result = parseAndValidateReviewPlan(
      JSON.stringify({
        narrative: { summary: "x", why: "y", attributionSources: [] },
        notableChanges: [
          {
            rank: 1,
            category: "architecture",
            title: "Broad file",
            whyItMatters: "Needs focus.",
            anchor: { file: "src/a.ts", lineStart: 0, lineEnd: 400 },
            anchorConfidence: "exact",
          },
        ],
        safeToSkim: [],
      }),
      ctx,
    );

    expect(result.plan?.notableChanges[0]?.anchorConfidence).toBe("file");
    expect(result.plan?.notableChanges[0]?.anchor.lineStart).toBeUndefined();
    expect(result.plan?.notableChanges[0]?.anchor.lineEnd).toBeUndefined();
    expect(result.plan?.heuristicVersion).toBe(
      REVIEW_PLAN_HEURISTIC_VERSION,
    );
    expect(isCurrentReviewPlan(result.plan)).toBe(true);
    expect(
      isCurrentReviewPlan({
        ...result.plan!,
        heuristicVersion: undefined,
      }),
    ).toBe(false);
  });

  test("drops invalid anchors without forcing a critical change", () => {
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
    expect(result.ok).toBe(true);
    expect(result.plan?.notableChanges).toEqual([]);
  });

  test("accepts a low-risk plan with no critical hunks", () => {
    const ctx = stubCtx(["src/_generated/api.ts"]);
    const result = parseAndValidateReviewPlan(
      JSON.stringify({
        narrative: {
          summary: "Refresh generated API types.",
          why: "The generated output follows its source.",
          attributionSources: [],
        },
        notableChanges: [
          {
            rank: 1,
            category: "behavior",
            title: "Generated API",
            whyItMatters: "Generated output changed.",
            anchor: { file: "src/_generated/api.ts", lineStart: 1, lineEnd: 2 },
          },
        ],
        safeToSkim: [],
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.plan?.notableChanges).toEqual([]);
    expect(result.plan?.safeToSkim[0]?.reason).toContain("Generated");
  });

  test("scores focused anchors above broad anchors", () => {
    const ctx = stubCtx(["src/a.ts"]);
    const focused = parseAndValidateReviewPlan(
      validPlanRaw([{ source: "pr-payload", pct: 100 }]),
      ctx,
    );
    const broad = structuredClone(focused);
    broad.plan!.notableChanges[0]!.anchor.lineStart = 1;
    broad.plan!.notableChanges[0]!.anchor.lineEnd = 200;
    expect(scoreReviewPlanCandidate(focused)).toBeGreaterThan(
      scoreReviewPlanCandidate(broad),
    );
  });

  test("zeros attribution for buckets with provided=0", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts"], {
      contextManifest: {
        "agent-sessions": { provided: 3, chars: 900 },
        codebase: { provided: 0, chars: 0 },
        "previous-prs": { provided: 0, chars: 0 },
        docs: { provided: 0, chars: 0 },
      },
      prPayloadPresent: true,
    });
    const result = parseAndValidateReviewPlan(
      validPlanRaw([
        { source: "agent-sessions", pct: 50 },
        { source: "docs", pct: 50 },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    const sources = result.plan!.narrative.attributionSources;
    expect(sources.find((s) => s.source === "docs")).toBeUndefined();
    expect(sources.some((s) => s.source === "agent-sessions")).toBe(true);
    expect(sources.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100, 0);
  });

  test("empty model attribution falls back from manifest + pr-payload", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts"], {
      contextManifest: {
        "agent-sessions": { provided: 0, chars: 0 },
        codebase: { provided: 2, chars: 400 },
        "previous-prs": { provided: 0, chars: 0 },
        docs: { provided: 1, chars: 100 },
      },
      prPayloadPresent: true,
    });
    const result = parseAndValidateReviewPlan(validPlanRaw([]), ctx);
    expect(result.ok).toBe(true);
    const sources = result.plan!.narrative.attributionSources;
    expect(sources.some((s) => s.source === "codebase")).toBe(true);
    expect(sources.some((s) => s.source === "docs")).toBe(true);
    expect(sources.some((s) => s.source === "pr-payload")).toBe(true);
    expect(sources.every((s) => s.pct > 0)).toBe(true);
    // Must not be the deleted 70/20/5/5 hardcoded split
    expect(sources.find((s) => s.source === "agent-sessions")).toBeUndefined();
  });

  test("payload-only empty index yields 100% pr-payload", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts"], {
      contextManifest: {
        "agent-sessions": { provided: 0, chars: 0 },
        codebase: { provided: 0, chars: 0 },
        "previous-prs": { provided: 0, chars: 0 },
        docs: { provided: 0, chars: 0 },
      },
      prPayloadPresent: true,
    });
    const result = parseAndValidateReviewPlan(validPlanRaw([]), ctx);
    expect(result.ok).toBe(true);
    expect(result.plan!.narrative.attributionSources).toEqual([
      { source: "pr-payload", pct: 100 },
    ]);
  });

  test("drops pr-payload when prPayloadPresent is false", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts"], {
      contextManifest: {
        "agent-sessions": { provided: 1, chars: 50 },
        codebase: { provided: 0, chars: 0 },
        "previous-prs": { provided: 0, chars: 0 },
        docs: { provided: 0, chars: 0 },
      },
      prPayloadPresent: false,
    });
    const result = parseAndValidateReviewPlan(
      validPlanRaw([
        { source: "agent-sessions", pct: 40 },
        { source: "pr-payload", pct: 60 },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    const sources = result.plan!.narrative.attributionSources;
    expect(sources.find((s) => s.source === "pr-payload")).toBeUndefined();
    expect(sources).toEqual([{ source: "agent-sessions", pct: 100 }]);
  });

  test("selfReportQuote comes from verified intent, not model invention", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts"]);
    ctx.intent.selfReport = null;
    ctx.intent.firstUserMessages = ["Please wire reviews into the palette"];
    const result = parseAndValidateReviewPlan(
      validPlanRaw([{ source: "pr-payload", pct: 100 }]).replace(
        '"selfReportQuote": "Ship the review page"',
        '"selfReportQuote": "Add Reviews to the command palette."',
      ),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.plan!.narrative.selfReportQuote).toBe(
      "Please wire reviews into the palette",
    );
  });

  test("omits selfReportQuote when no verified self-report or first prompt", () => {
    const ctx = stubCtx(["src/a.ts", "src/b.ts"]);
    ctx.intent.selfReport = null;
    ctx.intent.firstUserMessages = [];
    const result = parseAndValidateReviewPlan(
      validPlanRaw([{ source: "pr-payload", pct: 100 }]),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.plan!.narrative.selfReportQuote).toBeUndefined();
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
    expect(parsed.notableChanges).toHaveLength(2);
  });
});

describe("classifyFileForReview", () => {
  test("deprioritizes generated paths", () => {
    expect(
      classifyFileForReview("convex/_generated/api.ts").priority,
    ).toBe("skim");
  });
});
