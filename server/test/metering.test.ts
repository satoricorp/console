import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { createMockProvider } from "../src/llm/provider";
import {
  BASE_TRIAL_DAYS,
  MS_PER_DAY,
  TrialEntitlementUnavailableError,
} from "../src/metering/quota";
import { generateSummary } from "../src/summary/generate";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

// Unique per process run. bookmarks carries a UNIQUE index on
// (user_id, repo_full_name, branch_name) (migration 018), so a fixed user id
// made these seeds succeed exactly once per database and then fail with 23505
// on every later run. Tests must not assume the database was just created.
const meteringUserId = `metering-test-user-${crypto.randomUUID()}`;

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
      ${meteringUserId},
      '/Users/joe/git/gx'
    )
    RETURNING id
  `;

  const [bookmark] = await db<{ id: string }[]>`
    INSERT INTO bookmarks (
      user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
    ) VALUES (
      ${meteringUserId},
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
  });

  test("allows unlimited PR Summaries during the free trial week", async () => {
    const db = getSql();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      const bookmarkId = await seedBookmark(db, activeOrgId, `active-${i}`, now + i);
      await generateSummary(db, {
        orgId: activeOrgId,
        userId: meteringUserId,
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
        userId: meteringUserId,
        bookmarkId,
        provider: createMockProvider("blocked"),
      }),
    ).rejects.toThrow("free trial has ended");
  });

  test("reports entitlement authentication failure instead of expired trial", async () => {
    const db = getSql();
    const bookmarkId = await seedBookmark(
      db,
      expiredOrgId,
      "entitlement-auth",
      Date.now() + 50,
    );
    const originalFetch = globalThis.fetch;
    const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
    const originalCloudApiKey = process.env.GX_CLOUD_API_KEY;
    process.env.CONVEX_SITE_URL = "https://convex.test";
    process.env.GX_CLOUD_API_KEY = "wrong-key";
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

    try {
      await expect(
        generateSummary(db, {
          orgId: expiredOrgId,
          userId: "convex-user-entitlement-auth",
          bookmarkId,
          provider: createMockProvider("must not run"),
        }),
      ).rejects.toBeInstanceOf(TrialEntitlementUnavailableError);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalConvexSiteUrl === undefined) {
        delete process.env.CONVEX_SITE_URL;
      } else {
        process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
      }
      if (originalCloudApiKey === undefined) {
        delete process.env.GX_CLOUD_API_KEY;
      } else {
        process.env.GX_CLOUD_API_KEY = originalCloudApiKey;
      }
    }
  });

  // The standalone POST /v1/summaries/generate route was removed; the trial
  // gate is pinned by "blocks PR Summary after the free trial week" above at
  // the function boundary the webhook/publish paths call, and the 402 +
  // upgradeUrl HTTP contract stays covered by the OpenAI proxy quota tests.
});
