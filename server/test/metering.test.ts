import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { createMockProvider } from "../src/llm/provider";
import { BASE_TRIAL_DAYS, MS_PER_DAY } from "../src/metering/quota";
import { generateSummary } from "../src/summary/generate";
import { authHeaders, installTestAuth } from "./auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

async function seedBookmark(
  db: ReturnType<typeof getSql>,
  orgId: string,
  suffix: string,
  atMs: number,
) {
  const [event] = await db<{ id: string }[]>`
    INSERT INTO pr_events (
      created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
    ) VALUES (
      ${atMs},
      '0.1.0-test',
      ${`meter${suffix}`},
      ${JSON.stringify({ refRange: "main..HEAD", intentCandidates: [`quota test ${suffix}`] })}::jsonb,
      ${orgId},
      'metering-test-user',
      '/Users/joe/git/gx'
    )
    RETURNING id
  `;

  const [bookmark] = await db<{ id: string }[]>`
    INSERT INTO bookmarks (
      user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
    ) VALUES (
      'metering-test-user',
      ${`acme/quota-${suffix}`},
      ${`feat/quota-${suffix}`},
      ${atMs},
      ${atMs},
      ${orgId},
      ${event.id}
    )
    RETURNING id
  `;

  await db`
    INSERT INTO hunk_links (
      org_id, event_id, file, line_start, line_end,
      session_id, match_tier, confidence, authorship, tool, model
    ) VALUES (
      ${orgId}, ${event.id}, 'server/src/metering/quota.ts', 1, 10,
      ${`quota-session-${suffix}`}, 1, 0.9, 'agent', 'cursor', 'mock'
    )
  `;

  return bookmark.id;
}

describeDb("PR Summary metering", () => {
  let activeOrgId: string;
  let expiredOrgId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "mock";
    delete process.env.CONVEX_SITE_URL;
    installTestAuth();
    await runMigrations();

    const db = getSql();
    const now = Date.now();

    const [activeOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
    `;
    activeOrgId = activeOrg.id;

    const [expiredOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now - (BASE_TRIAL_DAYS + 1) * MS_PER_DAY})
      RETURNING id
    `;
    expiredOrgId = expiredOrg.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("allows unlimited PR Summaries during the free trial week", async () => {
    const db = getSql();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      const bookmarkId = await seedBookmark(db, activeOrgId, `active-${i}`, now + i);
      await generateSummary(db, {
        orgId: activeOrgId,
        userId: "metering-test-user",
        bookmarkId,
        provider: createMockProvider(`quota test active ${i}`),
      });
    }
  });

  test("blocks PR Summary after the free trial week", async () => {
    const db = getSql();
    const now = Date.now();
    const bookmarkId = await seedBookmark(db, expiredOrgId, "expired", now);

    await expect(
      generateSummary(db, {
        orgId: expiredOrgId,
        userId: "metering-test-user",
        bookmarkId,
        provider: createMockProvider("blocked"),
      }),
    ).rejects.toThrow("free trial has ended");
  });

  test("POST /v1/summaries/generate returns 402 after trial ends", async () => {
    const db = getSql();
    const now = Date.now();
    const bookmarkId = await seedBookmark(db, expiredOrgId, "expired-api", now + 100);

    const res = await app.request("http://localhost/v1/summaries/generate", {
      method: "POST",
      headers: {
        ...authHeaders("metering-test-user", expiredOrgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookmarkId }),
    });

    expect(res.status).toBe(402);
    const json = (await res.json()) as {
      error: string;
      upgradeUrl: string;
    };
    expect(json.error).toContain("free trial has ended");
    expect(json.upgradeUrl).toContain("upgrade");
  });
});
