import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

describeDb("publish artifact upsert", () => {
  const originalFetch = globalThis.fetch;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalGithubAppId = process.env.GITHUB_APP_ID;
  const originalGithubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalGithubAppId === undefined) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = originalGithubAppId;
    }
    if (originalGithubAppPrivateKey === undefined) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = originalGithubAppPrivateKey;
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("updates existing PR bookmark across org migration when push branch is main", async () => {
    const db = getSql();
    const now = Date.now();
    const installationId = Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
    const installedRepo = `acme/publish-main-${crypto.randomUUID()}`;
    const prNumber = Math.floor(Math.random() * 10_000) + 1;
    const prUrl = `https://github.com/${installedRepo}/pull/${prNumber}`;
    const userId = `github:publish-main-${crypto.randomUUID()}`;
    const fetchCalls: string[] = [];
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

    process.env.OPENAI_API_KEY = "mock";
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.match(new RegExp(`/repos/.+/pulls/${prNumber}$`))) {
        return new Response(
          JSON.stringify({ number: prNumber, body: "" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes(`/issues/${prNumber}/comments`)) {
        return new Response(JSON.stringify({ id: 9101 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await db`
      INSERT INTO github_app_installations (
        installation_id, account_login, updated_at_ms, installed_at_ms
      ) VALUES (
        ${installationId}, 'acme', ${now}, ${now}
      )
      ON CONFLICT (installation_id) DO NOTHING
    `;
    const [defaultOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
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
        'publish-main',
        'installed',
        ${now},
        ${now}
      )
    `;

    const [existingBookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id, head_commit_id
      ) VALUES (
        ${userId},
        ${installedRepo},
        'feature/stack-branch',
        ${prNumber},
        ${prUrl},
        ${now},
        ${now},
        ${defaultOrg.id},
        'old-head'
      )
      RETURNING id
    `;

    await db`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id, head_commit_id
      ) VALUES (
        ${userId},
        ${installedRepo},
        'main',
        ${prNumber + 1},
        ${`https://github.com/${installedRepo}/pull/${prNumber + 1}`},
        ${now},
        ${now},
        ${defaultOrg.id},
        'main-head'
      )
    `;

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        ...authHeaders(userId, defaultOrg.id),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "gx.pr",
        schema_version: 1,
        created_at: now + 1,
        gx_version: "test",
        repo: {
          root_path: "/tmp/publish-main",
          backend: "jj",
          default_branch: "main",
          remote_url: `https://github.com/${installedRepo}.git`,
          branch_name: "main",
        },
        push: {
          branch_name: "main",
          head_commit_id: "new-head-from-main",
          github_pull_request_url: prUrl,
        },
        stack: [
          {
            branch_name: "feature/stack-branch",
            base_branch_name: "main",
            patch: "diff --git a/README.md b/README.md\n",
            change: {
              description: "update README.md",
              files: ["README.md"],
            },
          },
        ],
        sessions: [],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; event_id: string; branch_name: string };
    expect(body.id).toBe(existingBookmark.id);
    expect(body.branch_name).toBe("feature/stack-branch");

    const [bookmark] = await db<{
      org_id: string;
      branch_name: string;
      head_commit_id: string | null;
    }[]>`
      SELECT org_id, branch_name, head_commit_id
      FROM bookmarks
      WHERE id = ${existingBookmark.id}
    `;
    expect(bookmark.org_id).toBe(installedOrg.id);
    expect(bookmark.branch_name).toBe("feature/stack-branch");
    expect(bookmark.head_commit_id).toBe("new-head-from-main");
  });

  test("attaches open PR to publish bookmark and clears webhook-only owner", async () => {
    const db = getSql();
    const now = Date.now();
    const installationId = Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
    const installedRepo = `acme/publish-link-${crypto.randomUUID()}`;
    const prNumber = Math.floor(Math.random() * 10_000) + 1;
    const prUrl = `https://github.com/${installedRepo}/pull/${prNumber}`;
    const userId = `github:publish-link-${crypto.randomUUID()}`;
    const branchName = `feature/link-${prNumber}`;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

    process.env.OPENAI_API_KEY = "mock";
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/pulls?") && url.includes("state=open")) {
        return new Response(
          JSON.stringify([{ number: prNumber, html_url: prUrl }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.match(new RegExp(`/repos/.+/pulls/${prNumber}$`))) {
        return new Response(
          JSON.stringify({ number: prNumber, body: "Author wrote this first." }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes(`/issues/${prNumber}/comments`)) {
        return new Response(JSON.stringify({ id: 9202, html_url: `${prUrl}#issuecomment-9202` }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    overview: "Links the open PR onto the publish bookmark.",
                    notable_changes: [],
                    risks: [],
                    test_plan: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

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
        'publish-link',
        'installed',
        ${now},
        ${now}
      )
    `;
    await db`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id
      ) VALUES (
        'github-webhook',
        ${installedRepo},
        ${branchName},
        ${prNumber},
        ${prUrl},
        ${now},
        ${now},
        ${installedOrg.id}
      )
    `;

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        ...authHeaders(userId, installedOrg.id),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "gx.pr",
        schema_version: 1,
        created_at: now + 1,
        gx_version: "test",
        repo: {
          root_path: "/tmp/publish-link",
          backend: "jj",
          default_branch: "main",
          remote_url: `https://github.com/${installedRepo}.git`,
          branch_name: branchName,
        },
        push: {
          branch_name: branchName,
          head_commit_id: "link-head",
        },
        stack: [
          {
            branch_name: branchName,
            base_branch_name: "main",
            patch: "diff --git a/a.ts b/a.ts\n",
            change: {
              description: "link open PR",
              files: ["a.ts"],
            },
          },
        ],
        sessions: [],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      github_pr_number: number | null;
      github_pr_url: string | null;
    };
    expect(body.github_pr_number).toBe(prNumber);
    expect(body.github_pr_url).toBe(prUrl);

    const [bookmark] = await db<{
      github_pr_number: number | null;
      latest_event_id: string | null;
      user_id: string;
    }[]>`
      SELECT github_pr_number, latest_event_id, user_id
      FROM bookmarks
      WHERE id = ${body.id}
    `;
    expect(bookmark.user_id).toBe(userId);
    expect(bookmark.github_pr_number).toBe(prNumber);
    expect(bookmark.latest_event_id).toBeTruthy();

    const leftovers = await db<{ id: string }[]>`
      SELECT id FROM bookmarks
      WHERE org_id = ${installedOrg.id}
        AND repo_full_name = ${installedRepo}
        AND github_pr_number = ${prNumber}
        AND id <> ${body.id}
    `;
    expect(leftovers).toHaveLength(0);
  });
});
