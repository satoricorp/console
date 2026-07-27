import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

// Unique per process run. bookmarks carries a UNIQUE index on
// (user_id, repo_full_name, branch_name) (migration 018), so a fixed user id
// seeds cleanly exactly once per database and then fails with 23505 on every
// later run. Tests must not assume the database was just created.
const activityUserId = `activity-test-user-${crypto.randomUUID()}`;

describeDb("activity feed API", () => {
  let orgId: string;
  let summaryId: string;
  let sessionId: string;
  let ruleId: string;

  beforeAll(async () => {
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

    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id
      ) VALUES (
        ${activityUserId}, 'acme/activity', 'main', ${now}, ${now}, ${orgId}
      )
      RETURNING id
    `;

    const [summary] = await db<{ id: string }[]>`
      INSERT INTO summaries (
        org_id, bookmark_id, content, model, latency_ms, posted_at_ms
      ) VALUES (
        ${orgId}, ${bookmark.id}, 'Intent\nTest summary', 'mock', 10, ${now + 3000}
      )
      RETURNING id
    `;
    summaryId = summary.id;

    const [session] = await db<{ id: string }[]>`
      INSERT INTO sessions_raw (
        org_id, session_id, tool, model, content, captured_at_ms
      ) VALUES (
        ${orgId}, 'activity-session', 'cursor', 'gpt-4', 'captured transcript', ${now + 2000}
      )
      RETURNING id
    `;
    sessionId = session.id;

    const [rule] = await db<{ id: string }[]>`
      INSERT INTO rules (
        org_id, repo_scope, rule_text, scope_expr, strength, status, created_at_ms
      ) VALUES (
        ${orgId}, 'acme/activity', 'prefer early returns', 'server/src/', 'preference', 'inferred', ${now + 1000}
      )
      RETURNING id
    `;
    ruleId = rule.id;
  });

  afterAll(async () => {
  });

  test("GET /v1/activity returns recent summaries, sessions, and rules", async () => {
    const res = await app.request("http://localhost/v1/activity?limit=20", {
      headers: authHeaders(activityUserId, orgId),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      limit: number;
      items: Array<{ kind: string; id: string; atMs: number; title: string }>;
    };

    expect(json.limit).toBe(20);
    expect(json.items.length).toBeGreaterThanOrEqual(3);
    expect(json.items.some((i) => i.kind === "summary" && i.id === summaryId)).toBe(true);
    expect(json.items.some((i) => i.kind === "session" && i.id === sessionId)).toBe(true);
    expect(json.items.some((i) => i.kind === "rule" && i.id === ruleId)).toBe(true);

    for (let i = 1; i < json.items.length; i++) {
      expect(json.items[i - 1]!.atMs).toBeGreaterThanOrEqual(json.items[i]!.atMs);
    }
  });

  test("GET /v1/activity supports cursor pagination", async () => {
    const first = await app.request("http://localhost/v1/activity?limit=1", {
      headers: authHeaders(activityUserId, orgId),
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstJson.items.length).toBe(1);
    expect(firstJson.nextCursor).toBeTruthy();

    const second = await app.request(
      `http://localhost/v1/activity?limit=1&cursor=${encodeURIComponent(firstJson.nextCursor ?? "")}`,
      { headers: authHeaders(activityUserId, orgId) },
    );
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { items: Array<{ id: string }> };
    expect(secondJson.items.length).toBe(1);
    expect(secondJson.items[0]!.id).not.toBe(firstJson.items[0]!.id);
  });
});
