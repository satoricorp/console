import { createHmac, generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { validateSummary } from "../src/summary/validate";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const WEBHOOK_SECRET = "test-webhook-secret";
const INSTALLATION_ID = 424242;
const REPO_FULL_NAME = "acme/gx";
const PR_NUMBER = 17;

function signPayload(payload: string, secret = WEBHOOK_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

async function postWebhook(
  event: string,
  body: Record<string, unknown>,
  secret = WEBHOOK_SECRET,
) {
  const payload = JSON.stringify(body);
  return app.request("http://localhost/github/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": "test-delivery-id",
      "X-Hub-Signature-256": signPayload(payload, secret),
    },
    body: payload,
  });
}

describeDb("GitHub webhook", () => {
  let orgId: string;
  let bookmarkId: string;
  let eventId: string;
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.OPENAI_API_KEY = "mock";

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });

      if (url.includes("/embeddings")) {
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: Array.from({ length: 512 }, () => 0.01) }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("turbopuffer.com")) {
        return new Response(JSON.stringify({ status: "OK" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "installation-token-test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/issues/") && url.includes("/comments")) {
        return new Response(
          JSON.stringify({ id: 9001, html_url: "https://github.com/acme/gx/pull/17#issuecomment-9001" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/pulls/") && url.includes("/comments")) {
        return new Response(
          JSON.stringify({ id: 9002, html_url: "https://github.com/acme/gx/pull/17#discussion_r9002" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await runMigrations();
    const db = getSql();
    const now = Date.now();

    await db`
      INSERT INTO github_app_installations (
        installation_id, account_login, updated_at_ms, installed_at_ms
      ) VALUES (
        ${INSTALLATION_ID}, 'acme', ${now}, ${now}
      )
      ON CONFLICT (installation_id) DO NOTHING
    `;

    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${INSTALLATION_ID}, 'free', ${now})
      ON CONFLICT (installation_id) DO UPDATE SET plan = EXCLUDED.plan
      RETURNING id
    `;
    orgId = org.id;

    await db`DELETE FROM review_usage WHERE org_id = ${orgId}`;
    await db`DELETE FROM summary_events WHERE org_id = ${orgId}`;
    await db`DELETE FROM summaries WHERE org_id = ${orgId}`;

    await db`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        access_state, updated_at_ms, added_at_ms
      ) VALUES (
        999001, ${INSTALLATION_ID}, ${REPO_FULL_NAME}, 'acme', 'gx',
        'installed', ${now}, ${now}
      )
      ON CONFLICT (github_repo_id) DO NOTHING
    `;

    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now},
        '0.1.0-test',
        'deadbeef',
        ${JSON.stringify({
          refRange: "main..HEAD",
          intentCandidates: ["Webhook PR Summary test"],
        })}::jsonb,
        ${orgId},
        'webhook-test-user',
        '/Users/joe/git/gx'
      )
      RETURNING id
    `;
    eventId = event.id;

    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, github_pr_number, github_pr_url,
        published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        'webhook-test-user',
        ${REPO_FULL_NAME},
        'feat/webhook',
        ${PR_NUMBER},
        'https://github.com/acme/gx/pull/17',
        ${now},
        ${now},
        ${orgId},
        ${eventId}
      )
      RETURNING id
    `;
    bookmarkId = bookmark.id;

    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${orgId}, ${eventId}, 'server/src/github/webhook.ts', 1, 50,
        'webhook-session', 1, 0.9, 'agent', 'cursor', 'mock'
      )
    `;
  });

  afterEach(() => {
    fetchCalls.length = 0;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  });

  test("rejects invalid webhook signature", async () => {
    const res = await postWebhook("ping", { zen: "test" }, "wrong-secret");
    expect(res.status).toBe(401);
  });

  test("installation webhook upserts org linkage", async () => {
    const res = await postWebhook("installation", {
      action: "created",
      installation: {
        id: INSTALLATION_ID,
        account: { id: 1, login: "acme", type: "Organization" },
        repository_selection: "selected",
        app_id: 1,
        created_at: new Date().toISOString(),
      },
      repositories: [
        {
          id: 999001,
          full_name: REPO_FULL_NAME,
          name: "gx",
          private: true,
          default_branch: "main",
          owner: { login: "acme" },
        },
      ],
    });
    expect(res.status).toBe(200);

    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      SELECT id FROM orgs WHERE installation_id = ${INSTALLATION_ID}
    `;
    expect(org.id).toBe(orgId);
  });

  test("installation webhook enqueues index jobs for added repos", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf-key";
    fetchCalls.length = 0;

    const res = await postWebhook("installation", {
      action: "created",
      installation: {
        id: INSTALLATION_ID,
        account: { id: 1, login: "acme", type: "Organization" },
        repository_selection: "selected",
        app_id: 1,
        created_at: new Date().toISOString(),
      },
      repositories: [
        {
          id: 999002,
          full_name: "acme/install-index",
          name: "install-index",
          private: true,
          default_branch: "main",
          owner: { login: "acme" },
        },
      ],
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fetchCalls.some(
        (c) => c.url.includes("turbopuffer.com") || c.url.includes("/embeddings"),
      ),
    ).toBe(true);

    process.env.OPENAI_API_KEY = "mock";
    delete process.env.TURBOPUFFER_API_KEY;
  });

  test("installation_repositories webhook enqueues index jobs for added repos", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf-key";
    fetchCalls.length = 0;

    const res = await postWebhook("installation_repositories", {
      action: "added",
      installation: {
        id: INSTALLATION_ID,
        account: { id: 1, login: "acme", type: "Organization" },
        repository_selection: "selected",
        app_id: 1,
        created_at: new Date().toISOString(),
      },
      repositories_added: [
        {
          id: 999003,
          full_name: "acme/music",
          name: "music",
          private: true,
          default_branch: "main",
          owner: { login: "acme" },
        },
      ],
      repositories_removed: [],
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fetchCalls.some(
        (c) => c.url.includes("turbopuffer.com") || c.url.includes("/embeddings"),
      ),
    ).toBe(true);

    process.env.OPENAI_API_KEY = "mock";
    delete process.env.TURBOPUFFER_API_KEY;
  });

  test("pull_request opened generates summary and posts comment", async () => {
    const res = await postWebhook("pull_request", {
      action: "opened",
      installation: { id: INSTALLATION_ID },
      repository: {
        id: 999001,
        full_name: REPO_FULL_NAME,
        name: "gx",
        owner: { login: "acme" },
      },
      pull_request: {
        number: PR_NUMBER,
        title: "Add webhook",
        html_url: `https://github.com/${REPO_FULL_NAME}/pull/${PR_NUMBER}`,
        head: { ref: "feat/webhook", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
      },
    });

    expect(res.status).toBe(200);
    expect(fetchCalls.some((c) => c.url.includes("/access_tokens"))).toBe(true);
    expect(fetchCalls.some((c) => c.url.includes("/issues/17/comments"))).toBe(true);

    const db = getSql();
    const summaries = await db<{ content: string }[]>`
      SELECT content FROM summaries
      WHERE org_id = ${orgId} AND bookmark_id = ${bookmarkId}
      ORDER BY posted_at_ms DESC
      LIMIT 1
    `;
    expect(summaries.length).toBe(1);
    expect(validateSummary(summaries[0]!.content).ok).toBe(true);

    const comments = await db<{ author: string; github_comment_id: number | null }[]>`
      SELECT author, github_comment_id FROM pr_comments
      WHERE org_id = ${orgId} AND bookmark_id = ${bookmarkId} AND author = 'gx'
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    expect(comments.length).toBe(1);
    expect(Number(comments[0]?.github_comment_id)).toBe(9001);
  });

  test("review comment creates pr_comments, decisions, and rules", async () => {
    const reviewCommentId = 55501 + Math.floor(Math.random() * 100000);
    const res = await postWebhook("pull_request_review_comment", {
      action: "created",
      installation: { id: INSTALLATION_ID },
      repository: { full_name: REPO_FULL_NAME, owner: { login: "acme" } },
      pull_request: {
        number: PR_NUMBER,
        head: { ref: "feat/webhook" },
        html_url: `https://github.com/${REPO_FULL_NAME}/pull/${PR_NUMBER}`,
      },
      comment: {
        id: reviewCommentId,
        user: { login: "reviewer" },
        body: "never use var in server/src/",
        path: "server/src/github/webhook.ts",
        line: 12,
      },
    });

    expect(res.status).toBe(200);

    const db = getSql();
    const comments = await db<{ body: string; is_gx_mention: boolean }[]>`
      SELECT body, is_gx_mention FROM pr_comments
      WHERE org_id = ${orgId} AND github_comment_id = ${reviewCommentId}
    `;
    expect(comments.length).toBe(1);
    expect(comments[0]?.is_gx_mention).toBe(false);

    const decisions = await db<{ action: string }[]>`
      SELECT action FROM decisions
      WHERE org_id = ${orgId} AND bookmark_id = ${bookmarkId}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    expect(decisions[0]?.action).toBe("comment");

    const rules = await db<{ strength: string; rule_text: string }[]>`
      SELECT strength, rule_text FROM rules
      WHERE org_id = ${orgId} AND repo_scope = ${REPO_FULL_NAME}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    expect(rules[0]?.strength).toBe("binding");
    expect(rules[0]?.rule_text).toContain("use var");
  });

  test("@gx issue comment triggers handler and posts reply", async () => {
    const issueCommentId = 55502 + Math.floor(Math.random() * 100000);
    const [rule] = await getSql()<{ id: string }[]>`
      INSERT INTO rules (
        org_id, repo_scope, rule_text, scope_expr, strength, status, created_at_ms
      ) VALUES (
        ${orgId}, ${REPO_FULL_NAME}, 'never use var', 'server/src/', 'binding', 'enforced', ${Date.now()}
      )
      RETURNING id
    `;

    const res = await postWebhook("issue_comment", {
      action: "created",
      installation: { id: INSTALLATION_ID },
      repository: { full_name: REPO_FULL_NAME, owner: { login: "acme" } },
      issue: { number: PR_NUMBER, pull_request: {} },
      pull_request: {
        number: PR_NUMBER,
        head: { ref: "feat/webhook" },
        html_url: `https://github.com/${REPO_FULL_NAME}/pull/${PR_NUMBER}`,
      },
      comment: {
        id: issueCommentId,
        user: { login: "alice" },
        body: "@gx please skip rule never use var",
      },
    });

    expect(res.status).toBe(200);

    const db = getSql();
    const comments = await db<{ is_gx_mention: boolean }[]>`
      SELECT is_gx_mention FROM pr_comments
      WHERE org_id = ${orgId} AND github_comment_id = ${issueCommentId}
    `;
    expect(comments[0]?.is_gx_mention).toBe(true);
    expect(fetchCalls.some((c) => c.url.includes("/issues/17/comments"))).toBe(true);

    const [updatedRule] = await db<{ status: string }[]>`
      SELECT status FROM rules WHERE id = ${rule.id}
    `;
    expect(updatedRule.status).toBe("retired");
  });

  test("@gx issue comment backfills missed installation state", async () => {
    const missingInstallationId = INSTALLATION_ID + 1000;
    const repoFullName = "acme/missed-install";
    const issueCommentId = 65502 + Math.floor(Math.random() * 100000);

    const res = await postWebhook("issue_comment", {
      action: "created",
      installation: { id: missingInstallationId },
      repository: {
        id: 999777,
        full_name: repoFullName,
        name: "missed-install",
        private: false,
        default_branch: "main",
        owner: { login: "acme", type: "Organization" },
      },
      issue: { number: 31, pull_request: {} },
      comment: {
        id: issueCommentId,
        user: { login: "alice" },
        body: "@gx please skip rule never use var",
      },
    });

    expect(res.status).toBe(200);

    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      SELECT id FROM orgs WHERE installation_id = ${missingInstallationId}
    `;
    expect(org?.id).toBeTruthy();

    const comments = await db<{ is_gx_mention: boolean }[]>`
      SELECT is_gx_mention FROM pr_comments
      WHERE org_id = ${org.id} AND github_comment_id = ${issueCommentId}
    `;
    expect(comments[0]?.is_gx_mention).toBe(true);
    expect(fetchCalls.some((c) => c.url.includes("/issues/31/comments"))).toBe(true);
  });

  test("push webhook enqueues incremental index without blocking", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf-key";

    const res = await postWebhook("push", {
      installation: { id: INSTALLATION_ID },
      repository: { full_name: REPO_FULL_NAME },
      ref: "refs/heads/main",
      after: "abc123",
      commits: [{ message: "fix: hotfix deploy" }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; event: string };
    expect(json.ok).toBe(true);
    expect(json.event).toBe("push");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fetchCalls.some(
        (c) => c.url.includes("turbopuffer.com") || c.url.includes("/embeddings"),
      ),
    ).toBe(true);

    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });
});
