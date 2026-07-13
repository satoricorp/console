import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const originalFetch = globalThis.fetch;

describeDb("GET /bookmarks merge_status reconcile", () => {
  let orgId: string;
  let userId: string;
  let repoFullName: string;
  let prNumber: number;
  let bookmarkId: string;
  const installationId = 9_100_001;

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();

    const db = getSql();
    const now = Date.now();
    userId = `merge-sync-${crypto.randomUUID()}`;
    repoFullName = `acme/merge-sync-${crypto.randomUUID().slice(0, 8)}`;
    prNumber = 42;

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");

    await db`
      INSERT INTO github_app_installations (
        installation_id, account_login, updated_at_ms, installed_at_ms
      ) VALUES (
        ${installationId}, 'acme', ${now}, ${now}
      )
      ON CONFLICT (installation_id) DO NOTHING
    `;

    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${installationId}, 'free', ${now})
      ON CONFLICT (installation_id) DO UPDATE SET plan = EXCLUDED.plan
      RETURNING id
    `;
    orgId = org.id;

    await db`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        access_state, updated_at_ms, added_at_ms
      ) VALUES (
        ${Math.floor(Math.random() * 1_000_000_000) + 3_000_000},
        ${installationId},
        ${repoFullName},
        'acme',
        ${repoFullName.split("/")[1]!},
        'installed',
        ${now},
        ${now}
      )
    `;

    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id,
        repo_full_name,
        branch_name,
        title,
        revision,
        merge_status,
        github_pr_number,
        github_pr_url,
        published_at_ms,
        updated_at_ms,
        org_id
      ) VALUES (
        ${userId},
        ${repoFullName},
        'feature/stale-merged',
        'Stale merged PR',
        1,
        'open',
        ${prNumber},
        ${`https://github.com/${repoFullName}/pull/${prNumber}`},
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;
    bookmarkId = bookmark.id;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  });

  test("refreshes stale open merge_status so merged filter includes the bookmark", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/repos/${repoFullName}/pulls/${prNumber}`)) {
        return new Response(
          JSON.stringify({
            merged: true,
            state: "closed",
            merged_at: "2026-07-01T12:00:00Z",
            html_url: `https://github.com/${repoFullName}/pull/${prNumber}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const openBefore = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=open`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(openBefore.status).toBe(200);
    expect(await openBefore.json()).toEqual([]);

    const merged = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=merged`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(merged.status).toBe(200);
    const rows = (await merged.json()) as Array<{
      id: string;
      merge_status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: bookmarkId,
      merge_status: "merged",
    });

    const db = getSql();
    const [stored] = await db<{ merge_status: string }[]>`
      SELECT merge_status FROM bookmarks WHERE id = ${bookmarkId}::uuid
    `;
    expect(stored?.merge_status).toBe("merged");
  });
});
