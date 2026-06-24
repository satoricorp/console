import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
  buildGxCitationContext,
  formatGxCitedReply,
  inlineCitationIds,
  parseGxChatModelReply,
  validCitationIds,
} from "../src/gx-mention/citations";
import { handleGxMention } from "../src/gx-mention/handler";
import { buildGxChatUserPrompt } from "../src/llm/prompts/gx-chat";
import type { ExtractContext } from "../src/summary/generate";

describe("gx mention citations", () => {
  test("builds stable citations from GX published, hunk, session, and index evidence", () => {
    const context = makeContext({
      publishedRevisions: [
        {
          branchName: "docs/documentation",
          baseBranchName: "main",
          description: "documentation",
          files: ["README.md"],
          patch: "@@ -1 +1,2 @@\n # Music\n+GX smoke test",
          githubPrUrl: "https://github.com/acme/music/pull/1",
        },
      ],
      hunkLinks: [
        {
          file: "README.md",
          lineStart: 1,
          lineEnd: 2,
          sessionId: "session-one",
          matchTier: 1,
          confidence: 0.98,
          authorship: "agent",
          tool: "codex",
          model: "gpt-5",
        },
      ],
      sessionEvents: [
        {
          sessionId: "session-one",
          eventType: "response",
          filePath: "README.md",
          rawLine: 42,
          tool: "codex",
          model: "gpt-5",
        },
      ],
      indexSnippets: [
        {
          id: "README.md#intro",
          text: "Current README introduction",
          score: 0.91,
          sourceKind: "file",
        },
      ],
    });

    const result = buildGxCitationContext({
      latestSummary: null,
      context,
      gitBlameContext: null,
      githubPrFiles: [],
      recentComments: [],
    });

    expect(result.citations.map((citation) => citation.id)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
    ]);
    expect(result.citations.map((citation) => citation.kind)).toEqual([
      "published_revision",
      "hunk_link",
      "session_event",
      "index_snippet",
    ]);
    expect(result.promptText).toContain("[S1] published_revision: docs/documentation touched README.md");
    expect(result.promptText).toContain("[S2] hunk_link: README.md:1-2 agent hunk");
    expect(result.promptText).toContain("[S3] session_event: response in README.md");
    expect(result.promptText).toContain("[S4] index_snippet: file README.md#intro score=0.910");
    expect(result.promptText).toContain("+GX smoke test");
  });

  test("builds PR diff citations when no GX context is linked", () => {
    const result = buildGxCitationContext({
      latestSummary: null,
      context: null,
      gitBlameContext: null,
      githubPrFiles: [
        {
          filename: "README.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: "@@ -1 +1,2 @@\n # Music\n+GX smoke test",
        },
      ],
      recentComments: [],
    });

    expect(result.citations).toMatchObject([
      {
        id: "S1",
        kind: "github_pr_file",
        file: "README.md",
      },
    ]);
    expect(result.promptText).toContain("[S1] github_pr_file: README.md modified +1 -0");
    expect(result.promptText).toContain("+GX smoke test");
  });

  test("formats validated JSON replies and strips invented inline citation IDs", () => {
    const context = buildGxCitationContext({
      latestSummary: null,
      context: makeContext({
        publishedRevisions: [
          {
            branchName: "docs/documentation",
            baseBranchName: "main",
            description: "documentation",
            files: ["README.md"],
            patch: "+GX smoke test",
            githubPrUrl: null,
          },
        ],
      }),
      gitBlameContext: null,
      githubPrFiles: [],
      recentComments: [],
    });
    const parsed = parseGxChatModelReply(
      JSON.stringify({
        answer: "The README line was added in the latest revision. [S1] [S99]",
        citations: ["S1", "S99"],
      }),
    );

    expect(parsed).not.toBeNull();
    const requestedIds = [
      ...(parsed?.citations ?? []),
      ...inlineCitationIds(parsed?.answer ?? ""),
    ];
    const validIds = validCitationIds(requestedIds, context.citations);
    const reply = formatGxCitedReply(parsed?.answer ?? "", validIds, context.citations);

    expect(validIds).toEqual(["S1"]);
    expect(reply).toContain("GX: The README line was added in the latest revision. [S1]");
    expect(reply).toContain("Sources: [S1] published revision `README.md`.");
    expect(reply).not.toContain("S99");
  });

  test("handles missing citation context without adding a fake Sources line", () => {
    const context = buildGxCitationContext({
      latestSummary: null,
      context: null,
      gitBlameContext: null,
      githubPrFiles: [],
      recentComments: [],
    });
    const reply = formatGxCitedReply(
      "I need a linked GX review event or PR diff to answer.",
      [],
      context.citations,
    );

    expect(context.citations).toEqual([]);
    expect(context.promptText).toBe("Available sources:\n(none)");
    expect(reply).toBe("GX: I need a linked GX review event or PR diff to answer.");
    expect(reply).not.toContain("Sources:");
  });

  test("places server-built sources in the gx chat prompt", () => {
    const citationContext = buildGxCitationContext({
      latestSummary: "Intent\nDocs update",
      context: makeContext({
        publishedRevisions: [
          {
            branchName: "docs/documentation",
            baseBranchName: "main",
            description: "documentation",
            files: ["README.md"],
            patch: "+GX smoke test",
            githubPrUrl: null,
          },
        ],
      }),
      gitBlameContext: null,
      githubPrFiles: [],
      recentComments: [],
    });

    const prompt = buildGxChatUserPrompt({
      author: "alice",
      question: "what changed?",
      latestSummary: "Intent\nDocs update",
      context: null,
      recentComments: [],
      citationPromptText: citationContext.promptText,
    });

    expect(prompt.indexOf("Available sources:")).toBeLessThan(
      prompt.indexOf("Latest PR summary"),
    );
    expect(prompt).toContain("[S1] published_revision");
    expect(prompt).toContain("Latest PR summary (orientation only; cite Available sources for factual claims)");
  });

  test("keeps veto flow ahead of citation chat generation", async () => {
    const sqlCalls: string[] = [];
    const db = (async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      sqlCalls.push(sql);
      if (sql.includes("SELECT id, rule_text")) {
        return [{ id: "rule-1", rule_text: "never use var" }];
      }
      return [];
    }) as unknown as postgres.Sql;
    const originalConsoleInfo = console.info;
    console.info = () => {};

    try {
      const result = await handleGxMention(db, {
        orgId: "org",
        bookmarkId: "bookmark",
        commentId: "comment",
        author: "alice",
        body: "@gx please skip rule never use var",
      });

      expect(result.reply).toBe('GX: retired 1 rule(s) matching "never use var".');
      expect(result.retiredRuleIds).toEqual(["rule-1"]);
      expect(result.vetoedRuleText).toBe("never use var");
      expect(sqlCalls.some((sql) => sql.includes("SELECT id, content"))).toBe(false);
      expect(sqlCalls.some((sql) => sql.includes("FROM pr_comments"))).toBe(false);
    } finally {
      console.info = originalConsoleInfo;
    }
  });

  test("handles uncited no-context chat replies without a Sources line", async () => {
    const originalReviewModels = process.env.GX_REVIEW_MODELS;
    const originalConsoleInfo = console.info;
    const sqlCalls: string[] = [];
    const db = (async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      sqlCalls.push(sql);
      return [];
    }) as unknown as postgres.Sql;

    process.env.GX_REVIEW_MODELS = "mock";
    console.info = () => {};

    try {
      const result = await handleGxMention(db, {
        orgId: "org",
        bookmarkId: "bookmark",
        commentId: "comment",
        author: "alice",
        body: "@gx what changed?",
      });

      expect(result.reply).toBe(
        "GX: I couldn't answer from the available review context because no citeable sources were provided.",
      );
      expect(result.reply).not.toContain("Sources:");
      expect(result.retiredRuleIds).toEqual([]);
      expect(result.vetoedRuleText).toBeNull();
      expect(sqlCalls.some((sql) => sql.includes("SELECT id, content"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("FROM pr_comments"))).toBe(true);
    } finally {
      if (originalReviewModels === undefined) {
        delete process.env.GX_REVIEW_MODELS;
      } else {
        process.env.GX_REVIEW_MODELS = originalReviewModels;
      }
      console.info = originalConsoleInfo;
    }
  });
});

function makeContext(overrides: Partial<ExtractContext> = {}): ExtractContext {
  return {
    eventId: "event",
    bookmarkId: "bookmark",
    orgId: "org",
    repoRootPath: "/repo",
    headCommitId: "head",
    refRange: null,
    fileStats: null,
    intentCandidates: [],
    struggleSignals: [],
    humanOverrides: [],
    hunkLinks: [],
    sessionEvents: [],
    ...overrides,
  };
}
