import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

const originalFetch = globalThis.fetch;
const originalOpenAIKey = process.env.GX_OPENAI_API_KEY;
const originalOpenAIBaseURL = process.env.GX_CLOUD_OPENAI_BASE_URL;

describe("publish route", () => {
  test("POST /v1/publish is mounted behind local dev auth", async () => {
    const originalCloudApiKey = process.env.GX_CLOUD_API_KEY;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "development";

    try {
      const res = await app.request("http://localhost/v1/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Org-Id": "test-org",
        },
        body: "{",
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    } finally {
      if (originalCloudApiKey === undefined) {
        delete process.env.GX_CLOUD_API_KEY;
      } else {
        process.env.GX_CLOUD_API_KEY = originalCloudApiKey;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });
});

describeDb("compat bookmarks route", () => {
  let orgId: string;
  let repoFullName: string;

  beforeAll(async () => {
    installTestAuth();
    // GET /bookmarks and /v1/reviews both call reconcileOpenBookmarkMergeStatuses
    // before filtering, which hits api.github.com for every merge_status=open
    // row. Unmocked, that is a live network call from the test suite: GitHub
    // 404s on the synthetic acme/* repo and the reconcile marks the bookmark
    // closed, so the row under test disappears from merge_status=open. Answer
    // the PR-list endpoints with "this branch has an open PR" so the reconcile
    // is deterministic and offline.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.github.com")) {
        return new Response(
          JSON.stringify([
            {
              number: 4242,
              html_url: `https://github.com/${repoFullName}/pull/4242`,
              state: "open",
              merged: false,
              merged_at: null,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch in compat bookmarks test: ${url}`);
    }) as typeof fetch;
    await runMigrations();

    const db = getSql();
    const now = Date.now();
    repoFullName = `acme/bookmarks-${crypto.randomUUID()}`;
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
    `;
    orgId = org.id;

    await db`
      INSERT INTO bookmarks (
        user_id,
        repo_full_name,
        branch_name,
        title,
        revision,
        head_commit_id,
        remote_head_sha,
        merge_status,
        published_at_ms,
        updated_at_ms,
        org_id
      ) VALUES (
        'compat-test-user',
        ${repoFullName},
        'feature/compat',
        'Compat bookmark',
        3,
        'head123',
        'remote123',
        'open',
        ${now - 1},
        ${now},
        ${orgId}
      )
    `;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  });

  test("GET /bookmarks returns org-scoped bookmark rows for CLI sync", async () => {
    const res = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=open`,
      { headers: authHeaders("compat-test-user", orgId) },
    );

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      id: string;
      repo_full_name: string;
      branch_name: string;
      title: string | null;
      revision: number;
      head_commit_id: string | null;
      remote_head_sha: string | null;
      merge_status: string;
      updated_at_ms: number;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repo_full_name: repoFullName,
      branch_name: "feature/compat",
      title: "Compat bookmark",
      revision: 3,
      head_commit_id: "head123",
      remote_head_sha: "remote123",
      merge_status: "open",
    });
    expect(typeof rows[0]!.updated_at_ms).toBe("number");
  });

  test("GET /v1/reviews is canonical and /bookmarks forwards to it", async () => {
    const query = `repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=open`;
    const headers = authHeaders("compat-test-user", orgId);

    const canonical = await app.request(`http://localhost/v1/reviews?${query}`, {
      headers,
    });
    const legacy = await app.request(`http://localhost/bookmarks?${query}`, {
      headers,
    });

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    // Same handler, byte-identical body — the legacy path is an alias, not a redirect.
    expect(await legacy.json()).toEqual(await canonical.json());

    expect(canonical.headers.get("Deprecation")).toBeNull();
    expect(legacy.headers.get("Deprecation")).toBe("true");
    expect(legacy.headers.get("Link")).toContain("/v1/reviews");
  });

  test("GET /v1/reviews keeps the fields released CLIs read", async () => {
    const res = await app.request(
      `http://localhost/v1/reviews?repo_full_name=${encodeURIComponent(repoFullName)}&merge_status=open`,
      { headers: authHeaders("compat-test-user", orgId) },
    );

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      revision: number;
      remote_head_sha: string | null;
    }>;
    // Installed gx binaries gate catch-up on these two; do not drop them until
    // deprecated-route telemetry shows no old-CLI traffic.
    expect(rows[0]!.revision).toBe(3);
    expect(rows[0]!.remote_head_sha).toBe("remote123");
  });

  test("GET /bookmarks includes the user's own bookmarks from other orgs", async () => {
    const db = getSql();
    const now = Date.now();
    const [otherOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
    `;
    await db`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, title, revision,
        merge_status, published_at_ms, updated_at_ms, org_id
      ) VALUES
        ('compat-test-user', ${repoFullName}, 'feature/installed-org', 'Installed org bookmark', 1, 'open', ${now}, ${now + 1}, ${otherOrg.id}),
        ('someone-else', ${repoFullName}, 'feature/foreign', 'Foreign bookmark', 1, 'open', ${now}, ${now + 2}, ${otherOrg.id})
    `;

    const res = await app.request(
      `http://localhost/bookmarks?repo_full_name=${encodeURIComponent(repoFullName)}`,
      { headers: authHeaders("compat-test-user", orgId) },
    );

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ branch_name: string }>;
    expect(rows.map((row) => row.branch_name).sort()).toEqual([
      "feature/compat",
      "feature/installed-org",
    ]);
  });

  test("GET /bookmarks rejects invalid merge_status", async () => {
    const res = await app.request("http://localhost/bookmarks?merge_status=deleted", {
      headers: authHeaders("compat-test-user", orgId),
    });

    expect(res.status).toBe(400);
  });

  test("GET /bookmarks accepts merge_status=archived", async () => {
    const res = await app.request("http://localhost/bookmarks?merge_status=archived", {
      headers: authHeaders("compat-test-user", orgId),
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describeDb("compat OpenAI proxy routes", () => {
  // The proxy routes now run the cloud-AI quota gate, which resolves the
  // caller's org from the database — so these tests need a real in-trial org.
  let orgId: string;

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();

    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${Date.now()})
      RETURNING id
    `;
    orgId = org.id;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalOpenAIKey === undefined) {
      delete process.env.GX_OPENAI_API_KEY;
    } else {
      process.env.GX_OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalOpenAIBaseURL === undefined) {
      delete process.env.GX_CLOUD_OPENAI_BASE_URL;
    } else {
      process.env.GX_CLOUD_OPENAI_BASE_URL = originalOpenAIBaseURL;
    }
  });

  test("POST /gx/openai/chat-completions proxies valid chat payloads", async () => {
    process.env.GX_OPENAI_API_KEY = "test-openai-key";
    process.env.GX_CLOUD_OPENAI_BASE_URL = "https://openai.test/custom";
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "chatcmpl_test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await app.request("http://localhost/gx/openai/chat-completions", {
      method: "POST",
      headers: {
        ...authHeaders("openai-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "chatcmpl_test" });
    expect(requests[0]!.url).toBe("https://openai.test/custom/v1/chat/completions");
    expect((requests[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-openai-key",
    );
  });

  test("POST /gx/openai/responses proxies valid responses payloads", async () => {
    process.env.GX_OPENAI_API_KEY = "test-openai-key";
    process.env.GX_CLOUD_OPENAI_BASE_URL = "https://openai.test/v1";
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "resp_test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await app.request("http://localhost/gx/openai/responses", {
      method: "POST",
      headers: {
        ...authHeaders("openai-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-test",
        input: "review this",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "resp_test" });
    expect(requests[0]!.url).toBe("https://openai.test/v1/responses");
  });
});
