import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";

// Unique per process run. bookmarks carries a UNIQUE index on
// (user_id, repo_full_name, branch_name) (migration 018), so a fixed user id
// seeds cleanly exactly once per database and then fails with 23505 on every
// later run. Tests must not assume the database was just created.
const indexingUserId = `index-test-user-${crypto.randomUUID()}`;
import {
  resetIndexingFetch,
  runIncrementalIndex,
  setIndexingFetch,
} from "../src/indexing/turbopuffer";
import { describeDb } from "./db-gate";

describeDb("indexing turbopuffer", () => {
  let orgId: string;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf-key";
    await runMigrations();

    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${Date.now()})
      RETURNING id
    `;
    orgId = org.id;

    const now = Date.now();
    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, tx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now}, '0.1.0-test', 'abc123',
        ${JSON.stringify({ refRange: "main..HEAD" })}::jsonb,
        ${orgId}, ${indexingUserId}, '/Users/joe/git/tx'
      )
      RETURNING id
    `;

    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        ${indexingUserId}, 'acme/tx', 'main', ${now}, ${now}, ${orgId}, ${event.id}
      )
      RETURNING id
    `;

    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${orgId}, ${event.id}, 'server/src/indexing/turbopuffer.ts', 1, 20,
        'index-session', 1, 0.9, 'agent', 'cursor', 'mock'
      )
    `;
    void bookmark;
  });

  afterAll(async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
    resetIndexingFetch();
    globalThis.fetch = originalFetch;
  });

  test("returns disabled when API keys missing", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
    const db = getSql();
    const result = await runIncrementalIndex(db, {
      orgId,
      repoFullName: "acme/tx",
      reason: "push",
      ref: "refs/heads/main",
      afterSha: "deadbeef",
    });
    expect(result.status).toBe("disabled");
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf-key";
  });

  test("upserts chunks with mocked fetch when keys present", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    setIndexingFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, body: init?.body?.toString() });
        if (url.includes("/embeddings")) {
          return new Response(
            JSON.stringify({
              data: [{ index: 0, embedding: Array.from({ length: 512 }, () => 0.01) }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("turbopuffer.com")) {
          return new Response(JSON.stringify({ status: "OK" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const db = getSql();
    const result = await runIncrementalIndex(db, {
      orgId,
      repoFullName: "acme/tx",
      reason: "push",
      ref: "refs/heads/main",
      afterSha: "cafebabe",
      commitMessages: ["fix: index on push"],
    });

    expect(result.status).toBe("indexed");
    expect(result.chunks).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes("/embeddings"))).toBe(true);
    expect(calls.some((c) => c.url.includes("turbopuffer.com"))).toBe(true);
  });
});
