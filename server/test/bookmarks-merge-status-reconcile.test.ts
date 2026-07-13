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
  let openPrNumber: number;
  let stalePrNumber: number;
  let openBookmarkId: string;
  let staleBookmarkId: string;
  const installationId = 9_100_001;
  const individualPullUrls: string[] = [];

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();

    const db = getSql();
    const now = Date.now();
    userId = `merge-sync-${crypto.randomUUID()}`;
    repoFullName = `acme/merge-sync-${crypto.randomUUID().slice(0, 8)}`;
    openPrNumber = 41;
    stalePrNumber = 42;

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

    const [openBookmark] = await db<{ id: string }[]>`
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
        'feature/still-open',
        'Still open PR',
        1,
        'open',
        ${openPrNumber},
        ${`https://github.com/${repoFullName}/pull/${openPrNumber}`},
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;
    openBookmarkId = openBookmark.id;

    const [staleBookmark] = await db<{ id: string }[]>`
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
        ${stalePrNumber},
        ${`https://github.com/${repoFullName}/pull/${stalePrNumber}`},
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;
    staleBookmarkId = staleBookmark.id;
  });

  afterEach(() => {
    individualPullUrls.length = 0;
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  });

  test("repo open-PR list updates only stale bookmarks", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (
        url.includes(`/repos/${repoFullName}/pulls?`) &&
        url.includes("state=open")
      ) {
        return new Response(
          JSON.stringify([{ number: openPrNumber }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes(`/repos/${repoFullName}/pulls/`)) {
        individualPullUrls.push(url);
        const prMatch = url.match(/\/pulls\/(\d+)/);
        const prNumber = Number(prMatch?.[1]);
        if (prNumber === stalePrNumber) {
          return new Response(
            JSON.stringify({
              merged: true,
              state: "closed",
              merged_at: "2026-07-01T12:00:00Z",
              html_url: `https://github.com/${repoFullName}/pull/${stalePrNumber}`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ merged: false, state: "open" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const open = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=open`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(open.status).toBe(200);
    const openRows = (await open.json()) as Array<{ id: string }>;
    expect(openRows.map((row) => row.id)).toEqual([openBookmarkId]);

    const merged = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=merged`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(merged.status).toBe(200);
    const mergedRows = (await merged.json()) as Array<{
      id: string;
      merge_status: string;
    }>;
    expect(mergedRows).toHaveLength(1);
    expect(mergedRows[0]).toMatchObject({
      id: staleBookmarkId,
      merge_status: "merged",
    });

    // Still-open PR must not get a per-PR GitHub lookup after the open list.
    expect(
      individualPullUrls.some((url) => url.includes(`/pulls/${openPrNumber}`)),
    ).toBe(false);
    expect(
      individualPullUrls.some((url) => url.includes(`/pulls/${stalePrNumber}`)),
    ).toBe(true);

    const db = getSql();
    const [openStored] = await db<{ merge_status: string }[]>`
      SELECT merge_status FROM bookmarks WHERE id = ${openBookmarkId}::uuid
    `;
    const [staleStored] = await db<{ merge_status: string }[]>`
      SELECT merge_status FROM bookmarks WHERE id = ${staleBookmarkId}::uuid
    `;
    expect(openStored?.merge_status).toBe("open");
    expect(staleStored?.merge_status).toBe("merged");
  });

  test("404 PR lookup marks stale open bookmark closed", async () => {
    const db = getSql();
    const now = Date.now();
    const missingPr = 4040;
    const [missing] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, title, revision,
        merge_status, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id
      ) VALUES (
        ${userId},
        ${repoFullName},
        'feature/deleted-pr',
        'Deleted PR',
        1,
        'open',
        ${missingPr},
        ${`https://github.com/${repoFullName}/pull/${missingPr}`},
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (
        url.includes(`/repos/${repoFullName}/pulls?`) &&
        url.includes("state=open")
      ) {
        return new Response(JSON.stringify([{ number: openPrNumber }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/repos/${repoFullName}/pulls/${missingPr}`)) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.includes(`/repos/${repoFullName}/pulls/${stalePrNumber}`)) {
        return new Response(
          JSON.stringify({
            merged: true,
            state: "closed",
            merged_at: "2026-07-01T12:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    // Reset stale bookmark to open so reconcile has work; missing is already open.
    await db`
      UPDATE bookmarks SET merge_status = 'open', merged_at_ms = NULL
      WHERE id = ${staleBookmarkId}::uuid
    `;

    const res = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=closed`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; merge_status: string }>;
    expect(rows.some((row) => row.id === missing.id && row.merge_status === "closed")).toBe(
      true,
    );
  });

  test("URL-only github_pr_url reconciles without github_pr_number", async () => {
    const db = getSql();
    const now = Date.now();
    const urlOnlyPr = 77;
    const [urlOnly] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, title, revision,
        merge_status, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id
      ) VALUES (
        ${userId},
        ${repoFullName},
        'feature/url-only',
        'URL only PR',
        1,
        'open',
        NULL,
        ${`https://github.com/${repoFullName}/pull/${urlOnlyPr}`},
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (
        url.includes(`/repos/${repoFullName}/pulls?`) &&
        url.includes("state=open")
      ) {
        return new Response(JSON.stringify([{ number: openPrNumber }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/repos/${repoFullName}/pulls/${urlOnlyPr}`)) {
        return new Response(
          JSON.stringify({
            merged: true,
            state: "closed",
            merged_at: "2026-07-02T12:00:00Z",
            html_url: `https://github.com/${repoFullName}/pull/${urlOnlyPr}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes(`/repos/${repoFullName}/pulls/`)) {
        return new Response(
          JSON.stringify({ merged: false, state: "open" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const merged = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=merged`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(merged.status).toBe(200);
    const mergedRows = (await merged.json()) as Array<{ id: string }>;
    expect(mergedRows.some((row) => row.id === urlOnly.id)).toBe(true);

    const [stored] = await db<{ merge_status: string; github_pr_number: number | null }[]>`
      SELECT merge_status, github_pr_number FROM bookmarks WHERE id = ${urlOnly.id}::uuid
    `;
    expect(stored?.merge_status).toBe("merged");
    expect(Number(stored?.github_pr_number)).toBe(urlOnlyPr);
  });

  test("no-PR open bookmarks stay open when branch has no GitHub PR", async () => {
    const db = getSql();
    const now = Date.now();
    const [noPr] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, title, revision,
        merge_status, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id
      ) VALUES (
        ${userId},
        ${repoFullName},
        'feature/test-minimal',
        'test minimal',
        1,
        'open',
        NULL,
        NULL,
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;

    const branchLookups: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (
        url.includes(`/repos/${repoFullName}/pulls?`) &&
        url.includes("state=open") &&
        !url.includes("head=")
      ) {
        return new Response(JSON.stringify([{ number: openPrNumber }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("head=") && url.includes("/pulls?")) {
        branchLookups.push(url);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/repos/${repoFullName}/pulls/`)) {
        return new Response(
          JSON.stringify({ merged: false, state: "open" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const closed = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=closed`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(closed.status).toBe(200);
    const rows = (await closed.json()) as Array<{ id: string; merge_status: string }>;
    expect(rows.some((row) => row.id === noPr.id)).toBe(false);

    const open = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=open`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(open.status).toBe(200);
    const openRows = (await open.json()) as Array<{ id: string; merge_status: string }>;
    expect(openRows.some((row) => row.id === noPr.id && row.merge_status === "open")).toBe(
      true,
    );

    const [stored] = await db<{ merge_status: string }[]>`
      SELECT merge_status FROM bookmarks WHERE id = ${noPr.id}::uuid
    `;
    expect(stored?.merge_status).toBe("open");
  });

  test("main/HEAD/unknown no-PR bookmarks stay open without branch PR lookup", async () => {
    const db = getSql();
    const now = Date.now();
    const [mainBookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, title, revision,
        merge_status, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id
      ) VALUES (
        ${userId},
        ${repoFullName},
        'main',
        'main publish',
        1,
        'open',
        NULL,
        NULL,
        ${now},
        ${now},
        ${orgId}
      )
      RETURNING id
    `;

    let headQueryCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("head=")) {
        headQueryCount += 1;
      }
      if (
        url.includes(`/repos/${repoFullName}/pulls?`) &&
        url.includes("state=open")
      ) {
        return new Response(JSON.stringify([{ number: openPrNumber }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ merged: false, state: "open" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const closed = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=closed`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(closed.status).toBe(200);
    const rows = (await closed.json()) as Array<{ id: string }>;
    expect(rows.some((row) => row.id === mainBookmark.id)).toBe(false);
    expect(headQueryCount).toBe(0);

    const [stored] = await db<{ merge_status: string }[]>`
      SELECT merge_status FROM bookmarks WHERE id = ${mainBookmark.id}::uuid
    `;
    expect(stored?.merge_status).toBe("open");
  });

  test("merge_status=archived returns only archived bookmarks", async () => {
    const db = getSql();
    const now = Date.now();
    await db`
      UPDATE bookmarks
      SET archived_at_ms = ${now}, merge_status = 'open'
      WHERE id = ${openBookmarkId}::uuid
    `;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (
        url.includes(`/repos/${repoFullName}/pulls?`) &&
        url.includes("state=open")
      ) {
        return new Response(JSON.stringify([{ number: openPrNumber }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ merged: false, state: "open" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const archived = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=archived`,
      { headers: authHeaders(userId, orgId) },
    );
    expect(archived.status).toBe(200);
    const rows = (await archived.json()) as Array<{ id: string; archived_at_ms: number | null }>;
    expect(rows.every((row) => row.archived_at_ms != null)).toBe(true);
    expect(rows.some((row) => row.id === openBookmarkId)).toBe(true);

    await db`
      UPDATE bookmarks SET archived_at_ms = NULL WHERE id = ${openBookmarkId}::uuid
    `;
  });
});
