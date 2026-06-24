import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { createMockProvider } from "../src/llm/provider";
import { FREE_PR_SUMMARY_LIMIT } from "../src/metering/quota";
import { generateSummary } from "../src/summary/generate";
import { authHeaders, installTestAuth } from "./auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb("PR Summary metering", () => {
  let orgId: string;
  const bookmarkIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "mock";
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

    for (let i = 0; i < FREE_PR_SUMMARY_LIMIT; i++) {
      const [event] = await db<{ id: string }[]>`
        INSERT INTO pr_events (
          created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
        ) VALUES (
          ${now + i},
          '0.1.0-test',
          ${`meter${i}`},
          ${JSON.stringify({ refRange: "main..HEAD", intentCandidates: [`quota test ${i}`] })}::jsonb,
          ${orgId},
          'metering-test-user',
          '/Users/joe/git/gx'
        )
        RETURNING id
      `;
      eventIds.push(event.id);

      const [bookmark] = await db<{ id: string }[]>`
        INSERT INTO bookmarks (
          user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
        ) VALUES (
          'metering-test-user',
          ${`acme/quota-${i}`},
          ${`feat/quota-${i}`},
          ${now + i},
          ${now + i},
          ${orgId},
          ${event.id}
        )
        RETURNING id
      `;
      bookmarkIds.push(bookmark.id);

      await db`
        INSERT INTO hunk_links (
          org_id, event_id, file, line_start, line_end,
          session_id, match_tier, confidence, authorship, tool, model
        ) VALUES (
          ${orgId}, ${event.id}, 'server/src/metering/quota.ts', 1, 10,
          ${`quota-session-${i}`}, 1, 0.9, 'agent', 'cursor', 'mock'
        )
      `;

      await generateSummary(db, {
        orgId,
        userId: "metering-test-user",
        bookmarkId: bookmark.id,
        provider: createMockProvider(`quota test ${i}`),
      });
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("blocks 4th PR Summary via generateSummary", async () => {
    const db = getSql();
    const now = Date.now();
    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now},
        '0.1.0-test',
        'blocked',
        ${JSON.stringify({ refRange: "main..HEAD", intentCandidates: ["blocked"] })}::jsonb,
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
        'acme/quota-blocked',
        'feat/quota-blocked',
        ${now},
        ${now},
        ${orgId},
        ${event.id}
      )
      RETURNING id
    `;

    await expect(
      generateSummary(db, {
        orgId,
        userId: "metering-test-user",
        bookmarkId: bookmark.id,
        provider: createMockProvider("blocked"),
      }),
    ).rejects.toThrow("quota exceeded");
  });

  test("POST /v1/summaries/generate returns 402 on 4th summary", async () => {
    const db = getSql();
    const now = Date.now();
    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now + 100},
        '0.1.0-test',
        'blocked-api',
        ${JSON.stringify({ refRange: "main..HEAD", intentCandidates: ["blocked api"] })}::jsonb,
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
        'acme/quota-blocked-api',
        'feat/quota-blocked-api',
        ${now + 100},
        ${now + 100},
        ${orgId},
        ${event.id}
      )
      RETURNING id
    `;

    const res = await app.request("http://localhost/v1/summaries/generate", {
      method: "POST",
      headers: {
        ...authHeaders("metering-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookmarkId: bookmark.id }),
    });

    expect(res.status).toBe(402);
    const json = (await res.json()) as {
      error: string;
      used: number;
      limit: number;
      upgradeUrl: string;
    };
    expect(json.used).toBe(FREE_PR_SUMMARY_LIMIT);
    expect(json.limit).toBe(FREE_PR_SUMMARY_LIMIT);
    expect(json.upgradeUrl).toContain("upgrade");
  });
});
