import { describe, expect, test } from "bun:test";
import {
  buildPRSummaryUserPrompt,
  PR_SUMMARY_SYSTEM_PROMPT,
} from "../src/llm/prompts/pr-summary";
import type { ExtractContext } from "../src/summary/generate";

function ctx(overrides: Partial<ExtractContext> = {}): ExtractContext {
  return {
    eventId: "evt-1",
    bookmarkId: "bm-1",
    orgId: "org-1",
    repoRootPath: "/repo",
    headCommitId: "35c8e6a8",
    githubPrUrl: "https://github.com/satoricorp/gx/pull/112",
    refRange: "main..demo/index-freshness-check",
    fileStats: { excludedFiles: 0 },
    intentCandidates: [],
    struggleSignals: [],
    humanOverrides: [],
    hunkLinks: [],
    sessionEvents: [],
    ...overrides,
  };
}

describe("PR summary prompt: empty buckets", () => {
  test("states the manifest even when no context was retrieved at all", () => {
    const prompt = buildPRSummaryUserPrompt(ctx());
    expect(prompt).toContain("Context provided:");
    expect(prompt).toContain("previous-prs=0");
    expect(prompt).toContain("codebase=0");
  });

  test("names every empty bucket as uncitable", () => {
    const prompt = buildPRSummaryUserPrompt(ctx());
    expect(prompt).toContain("Empty buckets");
    expect(prompt).toContain("previous-prs");
    expect(prompt).toMatch(/do not write a bullet for them/i);
  });

  test("emits no Previous PRs section when the bucket is empty", () => {
    const prompt = buildPRSummaryUserPrompt(
      ctx({
        indexSnippets: [
          {
            id: "C1",
            text: "some code",
            bucket: "codebase",
            sourceKind: "code_file",
            file: "internal/cli/doctor.go",
          },
        ],
      }),
    );
    expect(prompt).toContain("previous-prs=0");
    expect(prompt).not.toContain("## Previous PRs");
  });

  test("system prompt forbids citing a zero-count bucket and allows silence", () => {
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /Only cite a bucket listed with a non-zero count/i,
    );
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /Citing nothing from a\s+bucket is always an acceptable outcome/i,
    );
  });

  test("system prompt binds bullets to this PR's own diff", () => {
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /Every bullet must describe a change visible in this PR's own diff/i,
    );
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /Never turn a context snippet into a bullet of its own/i,
    );
  });
});

describe("PR summary prompt: prior-PR citations", () => {
  test("shows a concrete branch@sha ref for a prior-PR snippet", () => {
    const prompt = buildPRSummaryUserPrompt(
      ctx({
        indexSnippets: [
          {
            id: "P1",
            text: "gx published revision diff.",
            bucket: "previous-prs",
            sourceKind: "published_revision_diff",
            file: "internal/codereview/judge.go",
            ref: "main@a001eaac",
          },
        ],
      }),
    );
    expect(prompt).toContain("## Previous PRs");
    expect(prompt).toContain("ref=main@a001eaac");
  });

  test("system prompt forbids rendering a P-label as a PR number", () => {
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /never turn one into a `PR #N` yourself/i,
    );
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /The bracket labels\s+\[P1\], \[P2\] are prompt labels, not PR numbers/i,
    );
  });

  test("system prompt still allows a PR number that appears in the material", () => {
    // The OSS watch rail shares this system prompt and parses real PR numbers
    // out of the PR body and diff (summary/external.ts). A blanket ban on
    // `PR #N` would be wrong there, where the numbers are vouched for.
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /a `PR #N` that literally\s+appears in the material above/i,
    );
  });
});

describe("PR summary prompt: severity", () => {
  test("system prompt defines all three severity levels", () => {
    // enrichSeverityDots only makes the emoji agree with whichever word the
    // model chose; nothing else calibrates the choice. Losing the legend
    // leaves 🔴/HIGH defined nowhere and quietly biases every summary toward
    // the LOW shown in the format example.
    expect(PR_SUMMARY_SYSTEM_PROMPT).toContain("🟢 = LOW");
    expect(PR_SUMMARY_SYSTEM_PROMPT).toContain("🟡 = MEDIUM");
    expect(PR_SUMMARY_SYSTEM_PROMPT).toContain("🔴 = HIGH");
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /same color on the verdict line and Blast Radius level/i,
    );
    // Each level carries its own verdict label; "Quick scan" on a 🔴 summary
    // would read as permission to skim.
    expect(PR_SUMMARY_SYSTEM_PROMPT).toContain("label **Quick scan**");
    expect(PR_SUMMARY_SYSTEM_PROMPT).toContain("label **Careful pass**");
    expect(PR_SUMMARY_SYSTEM_PROMPT).toContain("label **Deep review**");
  });

  test("system prompt tells the model not to default to LOW", () => {
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /Judge severity by blast radius, not by how tidy the code looks/i,
    );
  });
});

describe("PR summary prompt: diff stats", () => {
  test("states authoritative counts and does not present fileStats as diff totals", () => {
    const prompt = buildPRSummaryUserPrompt(
      ctx({
        diffStats: {
          files: 2,
          added: 137,
          removed: 0,
          revisions: 1,
          revisionsSeen: 1,
          perFile: [
            { file: "internal/cli/doctor.go", added: 92, removed: 0 },
            {
              file: "internal/cli/doctor_code_index_test.go",
              added: 45,
              removed: 0,
            },
          ],
        },
      }),
    );
    expect(prompt).toContain("2 file(s), +137/-0 lines");
    expect(prompt).toContain("authoritative");
    expect(prompt).toContain(
      "Capture file stats (excluded-file bookkeeping, not diff totals)",
    );
  });

  test("system prompt bans counting lines from the truncated excerpt", () => {
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /Never count lines yourself from a patch excerpt/i,
    );
    expect(PR_SUMMARY_SYSTEM_PROMPT).toMatch(
      /omit\s+the \+X\/-Y figure entirely rather than estimating one/i,
    );
  });
});
