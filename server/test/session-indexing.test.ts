import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import { embeddingDimensions } from "../src/indexing/config";
import {
  indexPublishedArtifact,
  resetIndexingFetch,
  setIndexingFetch,
  splitTextIntoWindows,
} from "../src/indexing/turbopuffer";
import { loadPublishedSessionTexts } from "../src/publish/bookmark";
import { publishedSessionsFromPayload } from "../src/summary/generate";
import { describeDb } from "./db-gate";

/**
 * Regression suite for the session-husk bug: published_session_context chunks
 * used to embed only a metadata card ("Repo/Branch/Session/Requests: N") even
 * though the full transcript had already arrived through POST /v1/sessions.
 * Retrieval over the agent-sessions bucket could answer "a session existed"
 * and nothing else.
 */

type UpsertRow = { id: string; text?: string; [key: string]: unknown };

function collectUpserts(): { rows: UpsertRow[] } {
  const captured = { rows: [] as UpsertRow[] };
  setIndexingFetch(
    mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
      if (url.includes("/embeddings")) {
        const inputs = (body as { input: string[] }).input;
        return Response.json({
          data: inputs.map((_, index) => ({
            index,
            embedding: Array.from({ length: embeddingDimensions }, () => 0.01),
          })),
        });
      }
      if (Array.isArray(body?.upsert_rows)) {
        captured.rows.push(...(body.upsert_rows as UpsertRow[]));
      }
      return Response.json({ status: "OK" });
    }) as unknown as typeof fetch,
  );
  return captured;
}

describe("published session chunks", () => {
  afterEach(() => {
    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });

  function artifactInput(sessionTexts?: Record<string, { tool?: string; content: string }>) {
    return {
      orgId: "org-1",
      repoFullName: "acme/app",
      eventId: "event-1",
      branchName: "feature/x",
      headSha: "abc123",
      payload: {
        revisions: [],
        sessions: [{ id: "sess-1", command: "claude", cwd: "/work/app" }],
      } as never,
      sessionTexts,
    };
  }

  test("embeds transcript content, windowed per part, when the transcript is available", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const captured = collectUpserts();

    const transcript = [
      "[user] Please make the retry loop stop hammering the API.",
      "[assistant] The loop retries without backoff; adding exponential backoff with a cap.",
      "[assistant] Decided against jitter here because the caller is single-threaded.",
    ].join("\n");

    const result = await indexPublishedArtifact(
      artifactInput({ "sess-1": { tool: "claude", content: transcript } }),
    );
    expect(result.status).toBe("indexed");

    const sessionRows = captured.rows.filter(
      (row) => row.source_kind === "published_session_context",
    );
    expect(sessionRows).toHaveLength(1);
    const text = String(sessionRows[0]!.text);
    // The metadata header is still there…
    expect(text).toContain("Session: sess-1");
    expect(text).toContain("Tool: claude");
    // …and the transcript content is now actually in the embedded text.
    expect(text).toContain("exponential backoff");
    expect(text).toContain("Decided against jitter");
    expect(text).toContain("Transcript part 1/1");
  });

  test("windows a long transcript into multiple chunks and marks the cap", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const captured = collectUpserts();

    // ~40 KB of transcript at a ~5 KB usable budget → several parts, but the
    // line volume stays under the per-session cap.
    const transcript = Array.from(
      { length: 800 },
      (_, i) => `[assistant] decision ${i}: keep the invariant that writers resolve namespaces.`,
    ).join("\n");

    const result = await indexPublishedArtifact(
      artifactInput({ "sess-1": { content: transcript } }),
    );
    expect(result.status).toBe("indexed");

    const sessionRows = captured.rows.filter(
      (row) => row.source_kind === "published_session_context",
    );
    expect(sessionRows.length).toBeGreaterThan(1);
    expect(sessionRows.length).toBeLessThanOrEqual(12);
    // Every part is under the chunk byte budget.
    for (const row of sessionRows) {
      expect(Buffer.byteLength(String(row.text), "utf8")).toBeLessThanOrEqual(8_000);
    }
    // Distinct ids per part — parts must not overwrite each other.
    expect(new Set(sessionRows.map((row) => row.id)).size).toBe(sessionRows.length);
  });

  test("falls back to the metadata card when no transcript arrived", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const captured = collectUpserts();

    const result = await indexPublishedArtifact(artifactInput(undefined));
    expect(result.status).toBe("indexed");

    const sessionRows = captured.rows.filter(
      (row) => row.source_kind === "published_session_context",
    );
    expect(sessionRows).toHaveLength(1);
    expect(String(sessionRows[0]!.text)).toContain("Session: sess-1");
  });
});

describe("splitTextIntoWindows", () => {
  test("splits on line boundaries within the byte budget", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const windows = splitTextIntoWindows(text, 200);
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(Buffer.byteLength(window, "utf8")).toBeLessThanOrEqual(512);
    }
    expect(windows.join("\n")).toContain("line 99");
  });

  test("hard-splits an oversized line without cutting a code point", () => {
    const line = "é".repeat(2_000); // 2 bytes per char
    const windows = splitTextIntoWindows(line, 1_000);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.join("")).toBe(line);
  });
});

describe("publishedSessionsFromPayload response counts", () => {
  test("counts responses instead of hardcoding zero", () => {
    const rows = publishedSessionsFromPayload({
      sessions: [
        {
          id: "sess-1",
          command: "claude",
          requests: [
            { responses: [{}, {}] },
            { responses: [{}] },
            {},
          ] as never[],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestCount).toBe(3);
    expect(rows[0]!.responseCount).toBe(3);
  });
});

describeDb("loadPublishedSessionTexts", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  test("returns the latest transcript per session, org-scoped", async () => {
    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    const [otherOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    await db`
      INSERT INTO sessions_raw (org_id, session_id, tool, content, captured_at_ms) VALUES
        (${org.id}, 'sess-a', 'claude', 'old capture', 1000),
        (${org.id}, 'sess-a', 'claude', 'new capture', 2000),
        (${otherOrg.id}, 'sess-b', 'codex', 'other org content', 3000)
    `;

    const texts = await loadPublishedSessionTexts(db, org.id, {
      sessions: [{ id: "sess-a" }, { id: "sess-b" }, { id: "sess-missing" }],
    } as never);

    expect(texts["sess-a"]).toEqual({ tool: "claude", content: "new capture" });
    // Another org's transcript must never leak into this org's index.
    expect(texts["sess-b"]).toBeUndefined();
    expect(texts["sess-missing"]).toBeUndefined();
  });

  test("empty session list short-circuits without querying", async () => {
    const db = getSql();
    const texts = await loadPublishedSessionTexts(db, "00000000-0000-4000-8000-000000000001", {
      sessions: [],
    } as never);
    expect(texts).toEqual({});
  });
});
