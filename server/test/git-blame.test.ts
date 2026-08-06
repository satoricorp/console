import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import { loadGitBlameContext, parsePatchHunks } from "../src/github/git-blame";
import { buildTxChatUserPrompt } from "../src/llm/prompts/gx-chat";
import type { ExtractContext } from "../src/summary/generate";
import { describeDb } from "./db-gate";

// Unique per process run. bookmarks carries a UNIQUE index on
// (user_id, repo_full_name, branch_name) (migration 018), so a fixed user id
// seeds cleanly exactly once per database and then fails with 23505 on every
// later run. Tests must not assume the database was just created.
const blameUserId = `test-user-${crypto.randomUUID()}`;

describe("parsePatchHunks", () => {
  test("parses old and new ranges from GitHub patch hunks", () => {
    const hunks = parsePatchHunks([
      "@@ -40,6 +40,8 @@ export function handle()",
      "-old",
      "+new",
      "@@ -90 +92,0 @@ deleted",
    ].join("\n"));

    expect(hunks).toEqual([
      {
        oldStart: 40,
        oldLength: 6,
        oldEnd: 45,
        newStart: 40,
        newLength: 8,
        newEnd: 47,
      },
      {
        oldStart: 90,
        oldLength: 1,
        oldEnd: 90,
        newStart: 92,
        newLength: 0,
        newEnd: null,
      },
    ]);
  });
});

describe("gx chat prompt git_blame context", () => {
  test("includes GitHub PR file fallback when gx event context is missing", () => {
    const prompt = buildTxChatUserPrompt({
      author: "alice",
      question: "what changed?",
      latestSummary: null,
      context: null,
      githubPrFiles: [
        {
          filename: "README.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: "@@ -1 +1,2 @@\n # Music\n+gx smoke test",
        },
      ],
      recentComments: [],
    });

    expect(prompt).toContain("GitHub PR file diff fallback");
    expect(prompt).toContain("- README.md status=modified +1 -0");
    expect(prompt).toContain("+gx smoke test");
  });

  test("includes gx published revision diffs from artifact context", () => {
    const prompt = buildTxChatUserPrompt({
      author: "alice",
      question: "what changed?",
      latestSummary: null,
      context: {
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
        publishedRevisions: [
          {
            branchName: "docs/documentation",
            baseBranchName: "main",
            description: "documentation",
            files: ["README.md"],
            patch: "@@ -1 +1,2 @@\n # Music\n+gx smoke test",
            githubPrUrl: "https://github.com/acme/music/pull/1",
          },
        ],
        publishedSessions: [
          {
            sessionId: "session-one",
            command: "codex",
            cwd: "/repo",
            requestCount: 1,
            responseCount: 1,
          },
        ],
      },
      recentComments: [],
    });

    expect(prompt).toContain("gx published revision diffs");
    expect(prompt).toContain("branch=docs/documentation");
    expect(prompt).toContain("+gx smoke test");
    expect(prompt).toContain("gx published session evidence");
  });

  test("labels published revision diff order as newest first", () => {
    const prompt = buildTxChatUserPrompt({
      author: "alice",
      question: "what changed latest?",
      latestSummary: null,
      context: {
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
        publishedRevisions: [
          {
            branchName: "docs/documentation",
            baseBranchName: "main",
            description: "newest revision",
            files: ["README.md"],
            patch: "+newest",
            githubPrUrl: null,
          },
          {
            branchName: "docs/documentation",
            baseBranchName: "main",
            description: "older revision",
            files: ["README.md"],
            patch: "+older",
            githubPrUrl: null,
          },
        ],
      },
      recentComments: [],
    });

    expect(prompt).toContain("gx published revision diffs (newest first)");
    expect(prompt.indexOf("newest revision")).toBeLessThan(
      prompt.indexOf("older revision"),
    );
  });

  test("keeps prior gx comments from overriding publish evidence", () => {
    const prompt = buildTxChatUserPrompt({
      author: "alice",
      question: "what changed latest?",
      latestSummary: null,
      context: {
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
        publishedRevisions: [
          {
            branchName: "docs/documentation",
            baseBranchName: "main",
            description: "newest revision",
            files: ["README.md"],
            patch: "+current publish evidence",
            githubPrUrl: null,
          },
        ],
      },
      recentComments: [
        {
          author: "gx-agentic-code-review",
          body: "gx: older bot answer about stale evidence",
          file: null,
          line: null,
        },
      ],
    });

    expect(prompt).toContain(
      "Recent PR comments (conversation history, not authoritative change evidence)",
    );
    expect(prompt).toContain(
      "gx-agentic-code-review (prior gx reply, not source of truth)",
    );
    expect(prompt).toContain("Authoritative gx published revision diffs");
    expect(prompt.indexOf("older bot answer")).toBeLessThan(
      prompt.indexOf("current publish evidence"),
    );
  });

  test("labels previous git work and includes markdown code links", () => {
    const ctx: ExtractContext = {
      eventId: "event",
      bookmarkId: "bookmark",
      orgId: "org",
      repoRootPath: null,
      headCommitId: "head",
      githubPrUrl: null,
      refRange: null,
      fileStats: null,
      intentCandidates: [],
      struggleSignals: [],
      humanOverrides: [],
      hunkLinks: [],
      sessionEvents: [],
    };

    const prompt = buildTxChatUserPrompt({
      author: "alice",
      question: "tell me the history",
      latestSummary: null,
      context: ctx,
      gitBlameContext: {
        source: "git_blame",
        repoFullName: "acme/gx",
        pullNumber: 17,
        baseSha: "base",
        headSha: "head",
        rows: [
          {
            filePath: "server/src/github/webhook.ts",
            previousFilePath: null,
            oldStart: 40,
            oldEnd: 45,
            newStart: 40,
            newEnd: 47,
            blameLineStart: 42,
            blameLineEnd: 45,
            commitSha: "prevsha1234567890",
            commitUrl: "https://github.com/acme/gx/commit/prevsha",
            authoredAtMs: Date.UTC(2026, 5, 12),
            authorLogin: "alice",
            authorName: null,
            messageHeadline: "Add webhook endpoint",
            associatedPrNumber: 12,
            associatedPrUrl: "https://github.com/acme/gx/pull/12",
            codeUrl: "https://github.com/acme/gx/blob/prevsha/server/src/github/webhook.ts#L42-L45",
            gxEventIds: ["event-prev"],
            gxSessionIds: ["session-prev"],
            gxSessionEvents: [],
          },
        ],
      },
      recentComments: [],
    });

    expect(prompt).toContain("git_blame context (previous GitHub/git work)");
    expect(prompt).toContain("[server/src/github/webhook.ts:42-45](https://github.com/acme/gx/blob/prevsha/server/src/github/webhook.ts#L42-L45)");
    expect(prompt).toContain("gx_provenance=captured");
  });
});

describeDb("loadGitBlameContext", () => {
  const originalFetch = globalThis.fetch;
  const originalAppId = process.env.GITHUB_APP_ID;
  const originalPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  let orgId: string;
  let currentEventId: string;
  let previousEventId: string;

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/repos/acme/gx/pulls/17")) {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/acme/gx/pull/17",
            base: { sha: "basesha", ref: "main" },
            head: { sha: "headsha", ref: "feat/blame" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/repos/acme/gx/pulls/17/files")) {
        return new Response(
          JSON.stringify([
            {
              filename: "server/src/github/webhook.ts",
              status: "modified",
              patch: "@@ -40,6 +40,8 @@ export function handleWebhook()",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/repos/acme/gx/pulls/17/commits")) {
        return new Response(
          JSON.stringify([
            {
              sha: "headsha",
              html_url: "https://github.com/acme/gx/commit/headsha",
              parents: [{ sha: "basesha" }],
              author: { login: "agent" },
              commit: {
                message: "Update mention handling\n\nBody",
                author: { date: "2026-06-17T10:00:00Z" },
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "https://api.github.com/graphql") {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                object: {
                  blame: {
                    ranges: [
                      {
                        startingLine: 42,
                        endingLine: 45,
                        age: 1,
                        commit: {
                          oid: "prevsha",
                          commitUrl: "https://github.com/acme/gx/commit/prevsha",
                          authoredDate: "2026-06-12T20:00:00Z",
                          messageHeadline: "Add webhook endpoint",
                          author: { name: "Builder", user: { login: "builder" } },
                          associatedPullRequests: {
                            nodes: [{ number: 12, url: "https://github.com/acme/gx/pull/12" }],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await runMigrations();
    const db = getSql();
    const now = Date.now();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
    `;
    orgId = org.id;

    const [previousEvent] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now - 10_000},
        '0.1.0-test',
        'prevsha',
        ${JSON.stringify({ refRange: "main..old" })}::jsonb,
        ${orgId},
        ${blameUserId},
        '/repo'
      )
      RETURNING id
    `;
    previousEventId = previousEvent.id;

    await db`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        ${blameUserId},
        'acme/gx',
        'old-webhook',
        12,
        'https://github.com/acme/gx/pull/12',
        ${now - 10_000},
        ${now - 10_000},
        ${orgId},
        ${previousEventId}
      )
    `;

    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${orgId}, ${previousEventId}, 'server/src/github/webhook.ts', 42, 45,
        'prev-session', 1, 0.95, 'agent', 'cursor', 'mock'
      )
    `;
    await db`
      INSERT INTO session_events (
        org_id, session_id, tool, model, ts, event_type, file_path,
        content_hash, raw_id, raw_line
      ) VALUES (
        ${orgId}, 'prev-session', 'cursor', 'mock', ${now - 9_000}, 'edit',
        'server/src/github/webhook.ts', 'hash', NULL, 7
      )
    `;

    const [currentEvent] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now},
        '0.1.0-test',
        'headsha',
        ${JSON.stringify({ refRange: "main..head" })}::jsonb,
        ${orgId},
        ${blameUserId},
        '/repo'
      )
      RETURNING id
    `;
    currentEventId = currentEvent.id;
    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${orgId}, ${currentEventId}, 'server/src/github/webhook.ts', 40, 47,
        'current-session', 1, 0.9, 'agent', 'cursor', 'mock'
      )
    `;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalAppId === undefined) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = originalAppId;
    }
    if (originalPrivateKey === undefined) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
    }
  });

  test("caches GitHub blame and joins previous gx provenance", async () => {
    const context = await loadGitBlameContext(getSql(), {
      orgId,
      repoFullName: "acme/gx",
      pullNumber: 17,
      installationId: 424242,
      eventId: currentEventId,
      fileHints: ["server/src/github/webhook.ts"],
    });

    expect(context?.rows.length).toBe(1);
    const row = context?.rows[0];
    expect(row?.commitSha).toBe("prevsha");
    expect(row?.messageHeadline).toBe("Add webhook endpoint");
    expect(row?.codeUrl).toBe("https://github.com/acme/gx/blob/prevsha/server/src/github/webhook.ts#L42-L45");
    expect(row?.gxEventIds).toContain(previousEventId);
    expect(row?.gxSessionIds).toContain("prev-session");
    expect(row?.gxSessionEvents[0]?.eventType).toBe("edit");

    const [snapshotCount] = await getSql()<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM git_blame_snapshots
      WHERE org_id = ${orgId}
        AND repo_full_name = 'acme/gx'
        AND ref_sha = 'basesha'
    `;
    expect(Number(snapshotCount.count)).toBe(1);
  });
});
