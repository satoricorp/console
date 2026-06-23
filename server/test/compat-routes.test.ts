import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

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

  test("GET /bookmarks rejects invalid merge_status", async () => {
    const res = await app.request("http://localhost/bookmarks?merge_status=deleted", {
      headers: authHeaders("compat-test-user", orgId),
    });

    expect(res.status).toBe(400);
  });

  test("POST /v1/publish resolves installed repo org and updates existing PR bookmark", async () => {
    const db = getSql();
    const now = Date.now();
    const installationId = Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
    const installedRepo = `acme/publish-${crypto.randomUUID()}`;
    const prNumber = Math.floor(Math.random() * 10_000) + 1;
    const prUrl = `https://github.com/${installedRepo}/pull/${prNumber}`;

    await db`
      INSERT INTO github_app_installations (
        installation_id, account_login, updated_at_ms, installed_at_ms
      ) VALUES (
        ${installationId}, 'acme', ${now}, ${now}
      )
      ON CONFLICT (installation_id) DO NOTHING
    `;
    const [installedOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${installationId}, 'free', ${now})
      ON CONFLICT (installation_id) DO UPDATE SET plan = EXCLUDED.plan
      RETURNING id
    `;
    await db`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        access_state, updated_at_ms, added_at_ms
      ) VALUES (
        ${Math.floor(Math.random() * 1_000_000_000) + 2_000_000},
        ${installationId},
        ${installedRepo},
        'acme',
        'publish-test',
        'installed',
        ${now},
        ${now}
      )
    `;

    const [existingBookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id
      ) VALUES (
        'github-webhook',
        ${installedRepo},
        'docs/documentation',
        ${prNumber},
        ${prUrl},
        ${now},
        ${now},
        ${installedOrg.id}
      )
      RETURNING id
    `;

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        ...authHeaders("cli-publish-user"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "gx.pr",
        schema_version: 1,
        created_at: now + 1,
        gx_version: "test",
        repo: {
          root_path: "/tmp/publish-test",
          backend: "jj",
          remote_url: `https://github.com/${installedRepo}.git`,
          branch_name: "docs/documentation",
        },
        push: {
          branch_name: "docs/documentation",
          head_commit_id: "abc123publish",
          github_pull_request_url: prUrl,
        },
        stack: [
          {
            branch_name: "docs/documentation",
            patch: "diff --git a/README.md b/README.md\n",
            change: {
              description: "update README.md",
              files: ["README.md"],
            },
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; event_id: string };
    expect(body.id).toBe(existingBookmark.id);

    const [bookmark] = await db<{
      org_id: string;
      latest_event_id: string | null;
      head_commit_id: string | null;
    }[]>`
      SELECT org_id, latest_event_id, head_commit_id
      FROM bookmarks
      WHERE id = ${existingBookmark.id}
    `;
    expect(bookmark.org_id).toBe(installedOrg.id);
    expect(bookmark.latest_event_id).toBe(body.event_id);
    expect(bookmark.head_commit_id).toBe("abc123publish");

    const [event] = await db<{ org_id: string }[]>`
      SELECT org_id FROM pr_events WHERE id = ${body.event_id}
    `;
    expect(event.org_id).toBe(installedOrg.id);

    const [{ count }] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM bookmarks
      WHERE org_id = ${installedOrg.id}
        AND repo_full_name = ${installedRepo}
        AND github_pr_number = ${prNumber}
    `;
    expect(count).toBe("1");
  });
});

describe("compat OpenAI proxy routes", () => {
  beforeAll(() => {
    installTestAuth();
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
        ...authHeaders("openai-test-user", crypto.randomUUID()),
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
        ...authHeaders("openai-test-user", crypto.randomUUID()),
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
