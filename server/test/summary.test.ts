import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { createMockProvider } from "../src/llm/provider";
import { generateSummary, loadExtractContext } from "../src/summary/generate";
import { validateSummary, REQUIRED_SECTIONS } from "../src/summary/validate";
import { authHeaders, installTestAuth } from "./auth";

describe("validateSummary", () => {
  const validSummary = [
    "Intent",
    "Add capture upload path for WP-1b.",
    "",
    "Read these",
    "- internal/capture/extract/upload.go",
    "",
    "Safe to skim",
    "- test fixtures",
    "",
    "Blast radius",
    "- CLI upload only",
    "",
    "Agent friction",
    "- tier-1 redaction required",
    "",
    "Provenance",
    "- GX capture sessions",
  ].join("\n");

  test("accepts valid 20-line summary with all sections", () => {
    const result = validateSummary(validSummary);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineCount).toBeLessThanOrEqual(20);
    }
  });

  test("rejects more than 20 lines", () => {
    const lines = validSummary.split("\n");
    const tooLong = [...lines, ...Array.from({ length: 5 }, (_, i) => `extra ${i}`)].join("\n");
    const result = validateSummary(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("too_many_lines");
    }
  });

  test("rejects missing sections", () => {
    for (const section of REQUIRED_SECTIONS) {
      const lines = validSummary
        .split("\n")
        .filter((line) => line.trim().toLowerCase() !== section.toLowerCase());
      const result = validateSummary(lines.join("\n"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("missing_section");
        expect(result.detail).toBe(section);
      }
    }
  });

  test("rejects word brief case-insensitively", () => {
    const withBrief = validSummary.replace("Intent", "Intent brief note");
    const result = validateSummary(withBrief);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("contains_brief");
    }
  });

  test("accepts markdown-style headings", () => {
    const markdown = validSummary
      .split("\n")
      .map((line) =>
        REQUIRED_SECTIONS.includes(line as (typeof REQUIRED_SECTIONS)[number])
          ? `## ${line}`
          : line,
      )
      .join("\n");
    expect(validateSummary(markdown).ok).toBe(true);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("generateSummary integration", () => {
  let orgId: string;
  let bookmarkId: string;
  let eventId: string;
  let commitOnlyBookmarkId: string;
  let commitOnlyEventId: string;
  let publishPreferredBookmarkId: string;
  let publishPreferredEventId: string;

  beforeAll(async () => {
    delete process.env.OPENAI_API_KEY;
    installTestAuth();
    await runMigrations();

    const db = getSql();
    const now = Date.now();

    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
    `;
    orgId = org.id;

    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now},
        '0.1.0-test',
        'cafebabe',
        ${JSON.stringify({
          refRange: "main..HEAD",
          fileStats: { filesChanged: 2, insertions: 10, deletions: 1 },
          intentCandidates: ["Wire PR Summary generator"],
        })}::jsonb,
        ${orgId},
        'summary-test-user',
        '/Users/joe/git/gx'
      )
      RETURNING id
    `;
    eventId = event.id;

    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        'summary-test-user',
        'acme/gx',
        'feat/summary',
        ${now},
        ${now},
        ${orgId},
        ${eventId}
      )
      RETURNING id
    `;
    bookmarkId = bookmark.id;

    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${orgId},
        ${eventId},
        'server/src/summary/generate.ts',
        1,
        40,
        'summary-session-1',
        1,
        0.95,
        'agent',
        'cursor',
        'gpt-4'
      )
    `;

    const [raw] = await db<{ id: string }[]>`
      INSERT INTO sessions_raw (
        org_id, session_id, tool, model, content, captured_at_ms
      ) VALUES (
        ${orgId},
        'summary-session-1',
        'cursor',
        'gpt-4',
        '[cursor] edit server/src/summary/generate.ts\npatch body\n[cursor] message done',
        ${now}
      )
      RETURNING id
    `;

    await db`
      INSERT INTO session_events (
        org_id, session_id, tool, model, ts, event_type, file_path,
        content_hash, raw_id, raw_line
      ) VALUES (
        ${orgId},
        'summary-session-1',
        'cursor',
        'gpt-4',
        ${now + 1},
        'edit',
        'server/src/summary/generate.ts',
        'hash-summary-test',
        ${raw.id},
        1
      )
    `;

    const [commitOnlyEvent] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now + 1},
        '0.1.0-test',
        'plain-git-head',
        ${JSON.stringify({
          refRange: "main..plain-git-head",
          intentCandidates: ["Plain Git capture context"],
        })}::jsonb,
        ${orgId},
        'summary-test-user',
        '/Users/joe/git/plain'
      )
      RETURNING id
    `;
    commitOnlyEventId = commitOnlyEvent.id;

    const [commitOnlyBookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms,
        org_id, remote_head_sha, head_commit_id
      ) VALUES (
        'github-webhook',
        'acme/plain',
        'feat/plain-git',
        ${now + 1},
        ${now + 1},
        ${orgId},
        'plain-git-head',
        'plain-git-head'
      )
      RETURNING id
    `;
    commitOnlyBookmarkId = commitOnlyBookmark.id;

    const [publishPreferredEvent] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now + 2},
        '0.1.0-test',
        'publish-head',
        ${JSON.stringify({
          event: "gx.pr",
          stack: [
            {
              change: {
                description: "Published artifact context",
                files: ["README.md"],
              },
              patch: "+published context",
            },
          ],
        })}::jsonb,
        ${orgId},
        'summary-test-user',
        '/Users/joe/git/published'
      )
      RETURNING id
    `;
    publishPreferredEventId = publishPreferredEvent.id;

    const [publishPreferredBookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms,
        org_id, latest_event_id, remote_head_sha, head_commit_id
      ) VALUES (
        'github-webhook',
        'acme/published',
        'docs/published',
        ${now + 2},
        ${now + 2},
        ${orgId},
        ${publishPreferredEventId},
        'publish-head',
        'publish-head'
      )
      RETURNING id
    `;
    publishPreferredBookmarkId = publishPreferredBookmark.id;

    await db`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now + 3},
        '0.1.0-test',
        'publish-head',
        ${JSON.stringify({
          refRange: "main..publish-head",
          intentCandidates: [],
        })}::jsonb,
        ${orgId},
        'summary-test-user',
        '/Users/joe/git/published'
      )
    `;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("mock generate inserts summaries and summary_events", async () => {
    const db = getSql();
    const result = await generateSummary(db, {
      orgId,
      eventId,
      provider: createMockProvider("Wire PR Summary generator"),
    });

    expect(result.summaryId).toBeTruthy();
    expect(result.bookmarkId).toBe(bookmarkId);
    expect(result.eventId).toBe(eventId);
    expect(result.lineCount).toBeLessThanOrEqual(20);
    expect(validateSummary(result.content).ok).toBe(true);

    const [summary] = await db<{ content: string; model: string }[]>`
      SELECT content, model FROM summaries WHERE id = ${result.summaryId}
    `;
    expect(summary.model).toBe("mock");
    expect(summary.content).toContain("Intent");

    const events = await db<{ kind: string }[]>`
      SELECT kind FROM summary_events WHERE summary_id = ${result.summaryId}
    `;
    expect(events.some((e) => e.kind === "view")).toBe(true);
  });

  test("POST /v1/summaries/generate returns summary metadata", async () => {
    const res = await app.request("http://localhost/v1/summaries/generate", {
      method: "POST",
      headers: {
        ...authHeaders("summary-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookmarkId }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      summaryId: string;
      bookmarkId: string;
      eventId: string;
      lineCount: number;
    };
    expect(json.bookmarkId).toBe(bookmarkId);
    expect(json.eventId).toBe(eventId);
    expect(json.lineCount).toBeLessThanOrEqual(20);
    expect(json.summaryId).toBeTruthy();
  });

  test("resolves bookmark context from current head commit without latest_event_id", async () => {
    const db = getSql();
    const result = await generateSummary(db, {
      orgId,
      bookmarkId: commitOnlyBookmarkId,
      provider: createMockProvider("Plain Git capture context"),
    });

    expect(result.bookmarkId).toBe(commitOnlyBookmarkId);
    expect(result.eventId).toBe(commitOnlyEventId);
    expect(validateSummary(result.content).ok).toBe(true);
  });

  test("prefers bookmark publish event over newer empty event for same head", async () => {
    const db = getSql();
    const result = await generateSummary(db, {
      orgId,
      bookmarkId: publishPreferredBookmarkId,
      provider: createMockProvider("Published artifact context"),
    });

    expect(result.bookmarkId).toBe(publishPreferredBookmarkId);
    expect(result.eventId).toBe(publishPreferredEventId);
    expect(validateSummary(result.content).ok).toBe(true);
  });

  test("unwraps legacy string-encoded publish payloads", async () => {
    const db = getSql();
    const context = await loadExtractContext(db, orgId, {
      bookmarkId: publishPreferredBookmarkId,
      eventId: publishPreferredEventId,
    });

    expect(context.publishedRevisions?.[0]?.description).toBe(
      "Published artifact context",
    );
    expect(context.publishedRevisions?.[0]?.patch).toContain("+published context");
  });

  test("returns 404 when bookmark missing", async () => {
    const res = await app.request("http://localhost/v1/summaries/generate", {
      method: "POST",
      headers: {
        ...authHeaders("summary-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookmarkId: "00000000-0000-0000-0000-000000000099" }),
    });
    expect(res.status).toBe(404);
  });
});
