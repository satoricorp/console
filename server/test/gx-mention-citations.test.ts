import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
  buildGxCitationContext,
  formatGxCitedReply,
  inlineCitationIds,
  parseGxChatModelReply,
  validCitationIds,
} from "../src/gx-mention/citations";
import { handleGxMention, shouldLoadGitHubPrFiles } from "../src/gx-mention/handler";
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
          lineStart: 1,
          lineEnd: 2,
          url: "https://github.com/acme/music/pull/1/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5R1",
        },
      ],
      recentComments: [],
    });

    expect(result.citations).toMatchObject([
      {
        id: "S1",
        kind: "github_pr_file",
        file: "README.md",
        lineStart: 1,
        lineEnd: 2,
        url: "https://github.com/acme/music/pull/1/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5R1",
      },
    ]);
    expect(result.promptText).toContain("[S1] github_pr_file: README.md:1-2 modified +1 -0");
    expect(result.promptText).toContain(
      "url: https://github.com/acme/music/pull/1/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5R1",
    );
    expect(result.promptText).toContain("+GX smoke test");
  });

  test("prefers exact PR line citations over broad published revision citations", () => {
    const citationContext = buildGxCitationContext({
      latestSummary: null,
      context: makeContext({
        publishedRevisions: [
          {
            branchName: "bug/fix-github-pr-summary",
            baseBranchName: "main",
            description: "refresh stored PR bodies on publish",
            files: ["internal/vcs/service.go"],
            patch: "+body := githubPullRequestBody(stack, pushed)",
            githubPrUrl: "https://github.com/satoricorp/gx/pull/11",
          },
        ],
      }),
      gitBlameContext: null,
      githubPrFiles: [
        {
          filename: "internal/vcs/service.go",
          status: "modified",
          additions: 60,
          deletions: 2,
          patch: "@@ -2470,7 +2470,7 @@\n-body := githubPullRequestBody(pushed)\n+body := githubPullRequestBody(stack, pushed)",
          lineStart: 2470,
          lineEnd: 2470,
          url: "https://github.com/satoricorp/gx/pull/11/files#diff-7dd1ac17bcaa7252a9b4b1610ed0a2e5acdd351174bd98cf8b31266440136bd3R2470",
        },
      ],
      recentComments: [],
    });

    expect(citationContext.citations.map((citation) => citation.kind)).toEqual([
      "github_pr_file",
      "published_revision",
    ]);

    const reply = formatGxCitedReply(
      "The risky change is the PR body rewrite path. [S1]",
      ["S1"],
      citationContext.citations,
    );

    expect(reply).toContain(
      "[internal/vcs/service.go:2470-2470](https://github.com/satoricorp/gx/pull/11/files#diff-7dd1ac17bcaa7252a9b4b1610ed0a2e5acdd351174bd98cf8b31266440136bd3R2470)",
    );
    expect(reply).not.toContain("published revision");
  });

  test("loads GitHub PR files when linked GX context has no line-linked hunks", () => {
    expect(shouldLoadGitHubPrFiles(null)).toBe(true);
    expect(
      shouldLoadGitHubPrFiles(
        makeContext({
          publishedRevisions: [
            {
              branchName: "bug/fix-github-pr-summary",
              baseBranchName: "main",
              description: "refresh stored PR bodies on publish",
              files: ["internal/vcs/service.go"],
              patch: null,
              githubPrUrl: "https://github.com/satoricorp/gx/pull/11",
            },
          ],
          hunkLinks: [],
        }),
      ),
    ).toBe(true);
    expect(
      shouldLoadGitHubPrFiles(
        makeContext({
          publishedRevisions: [
            {
              branchName: "bug/fix-github-pr-summary",
              baseBranchName: "main",
              description: "refresh stored PR bodies on publish",
              files: ["internal/vcs/service.go"],
              patch: null,
              githubPrUrl: "https://github.com/satoricorp/gx/pull/11",
            },
          ],
          hunkLinks: [
            {
              file: "internal/vcs/service.go",
              lineStart: 2470,
              lineEnd: 2470,
              sessionId: "session-one",
              matchTier: 1,
              confidence: 0.98,
              authorship: "agent",
              tool: "codex",
              model: "gpt-5",
            },
          ],
        }),
      ),
    ).toBe(false);
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

  test("denies rule veto from the webhook path when the author lacks write access", async () => {
    const sqlCalls: string[] = [];
    const db = (async (strings: TemplateStringsArray) => {
      sqlCalls.push(strings.join(" "));
      return [];
    }) as unknown as postgres.Sql;
    const originalFetch = globalThis.fetch;
    const originalConsoleInfo = console.info;
    console.info = () => {};
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/collaborators/")) {
        return new Response(JSON.stringify({ permission: "read" }), {
          status: 200,
        });
      }
      if (url.includes("/app/installations/")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 201,
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      const result = await handleGxMention(db, {
        orgId: "org",
        bookmarkId: "bookmark",
        commentId: "comment",
        author: "driveby",
        body: "@gx please skip rule never use var",
        github: {
          installationId: 123,
          repoFullName: "acme/repo",
          pullNumber: 7,
        },
      });

      expect(result.reply).toBe(
        "GX: only collaborators with write access can retire rules.",
      );
      expect(result.retiredRuleIds).toEqual([]);
      expect(sqlCalls.some((sql) => sql.includes("UPDATE rules"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      console.info = originalConsoleInfo;
    }
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
    githubPrUrl: null,
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
