import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

// Unique per process run. bookmarks carries a UNIQUE index on
// (user_id, repo_full_name, branch_name) (migration 018), so a fixed user id
// seeds cleanly exactly once per database and then fails with 23505 on every
// later run. Tests must not assume the database was just created.
const reviewUserId = `review-test-user-${crypto.randomUUID()}`;

const REPO_ROOT = "/Users/joe/git/gx";
const REPO_FULL_NAME = "acme/gx-review";
const REF_RANGE = "main..feat/review";

describeDb("review context API", () => {
  let orgId: string;
  let ruleId: string;

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
        'reviewsha',
        ${JSON.stringify({ refRange: REF_RANGE })}::jsonb,
        ${orgId},
        ${reviewUserId},
        ${REPO_ROOT}
      )
      RETURNING id
    `;

    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        ${reviewUserId},
        ${REPO_FULL_NAME},
        'feat/review',
        ${now},
        ${now},
        ${orgId},
        ${event.id}
      )
      RETURNING id
    `;

    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES
        (${orgId}, ${event.id}, 'server/src/review/context.ts', 1, 30, 'session-a', 1, 0.9, 'agent', 'cursor', 'mock'),
        (${orgId}, ${event.id}, 'server/src/review/context.ts', 40, 60, 'session-b', 1, 0.8, 'agent', 'cursor', 'mock')
    `;

    const [rule] = await db<{ id: string }[]>`
      INSERT INTO rules (
        org_id, repo_scope, rule_text, scope_expr, strength, status, created_at_ms
      ) VALUES (
        ${orgId}, ${REPO_FULL_NAME}, 'never use var', 'server/src/', 'binding', 'enforced', ${now}
      )
      RETURNING id
    `;
    ruleId = rule.id;
  });

  afterAll(async () => {
  });

  test("GET /v1/review/context returns rules, collisions, and hunk links", async () => {
    const url = new URL("http://localhost/v1/review/context");
    url.searchParams.set("repoRoot", REPO_ROOT);
    url.searchParams.set("base", "main");
    url.searchParams.set("head", "feat/review");

    const res = await app.request(url.toString(), {
      headers: authHeaders(reviewUserId, orgId),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      repoRoot: string;
      refRange: string;
      rules: Array<{ id: string; ruleText: string }>;
      collisions: Array<{ file: string; kind: string }>;
      hunkLinks: Array<{ file: string; sessionId: string }>;
      indexSnippets: unknown[];
    };

    expect(json.repoRoot).toBe(REPO_ROOT);
    expect(json.refRange).toBe(REF_RANGE);
    expect(json.rules.some((r) => r.id === ruleId)).toBe(true);
    expect(json.hunkLinks.length).toBe(2);
    expect(json.collisions.some((c) => c.kind === "hunk_overlap")).toBe(true);
    expect(Array.isArray(json.indexSnippets)).toBe(true);
  });

  test("returns 400 when query params missing", async () => {
    const res = await app.request("http://localhost/v1/review/context", {
      headers: authHeaders(reviewUserId, orgId),
    });
    expect(res.status).toBe(400);
  });
});
