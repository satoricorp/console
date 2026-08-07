import { afterAll, beforeAll, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

/**
 * A publish must not be able to name the row it lands in.
 *
 * `pr_id` in the bundle used to become the bookmark's primary key, upserted
 * with ON CONFLICT (id) DO UPDATE over org_id, user_id and repo_full_name — so
 * a caller who knew someone else's bookmark id could take the row, its review
 * history and its event chain into their own org. No client ever sent the
 * field; it is gone, and a bundle that still carries one is simply ignored.
 */
describeDb("publish ignores a client-supplied bookmark id", () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    installTestAuth();
    delete process.env.OPENAI_API_KEY;
    await runMigrations();
  });

  afterAll(() => {
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  test("leaves another user's bookmark alone and files a fresh one", async () => {
    const db = getSql();
    const now = Date.now();
    const victimUserId = `github:victim-${crypto.randomUUID()}`;
    const attackerUserId = `github:attacker-${crypto.randomUUID()}`;
    const victimRepo = `victim-co/app-${crypto.randomUUID()}`;

    const [victimOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${now}) RETURNING id
    `;
    const [attackerOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${now}) RETURNING id
    `;
    const [victimBookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms,
        org_id, head_commit_id, title
      ) VALUES (
        ${victimUserId},
        ${victimRepo},
        'main',
        ${now},
        ${now},
        ${victimOrg.id},
        'victim-head',
        'Victim review'
      )
      RETURNING id
    `;

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        ...authHeaders(attackerUserId, attackerOrg.id),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "gx.pr",
        schema_version: 1,
        created_at: now + 1,
        gx_version: "test",
        // The whole attack: claim the victim's row by id.
        pr_id: victimBookmark.id,
        repo: {
          root_path: "/tmp/attacker-checkout",
          backend: "git",
          default_branch: "main",
          branch_name: "feature/takeover",
        },
        push: {
          branch_name: "feature/takeover",
          head_commit_id: "attacker-head",
        },
        revisions: [
          {
            branch_name: "feature/takeover",
            base_branch_name: "main",
            patch: "diff --git a/a.ts b/a.ts\n",
            description: "takeover attempt",
            files: ["a.ts"],
          },
        ],
        sessions: [],
      }),
    });

    // The publish succeeds — it is an ordinary publish — but into its own row.
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).not.toBe(victimBookmark.id);

    const [victim] = await db<{
      user_id: string;
      org_id: string;
      repo_full_name: string;
      head_commit_id: string | null;
      title: string | null;
    }[]>`
      SELECT user_id, org_id, repo_full_name, head_commit_id, title
      FROM bookmarks
      WHERE id = ${victimBookmark.id}
    `;
    expect(victim.user_id).toBe(victimUserId);
    expect(victim.org_id).toBe(victimOrg.id);
    expect(victim.repo_full_name).toBe(victimRepo);
    expect(victim.head_commit_id).toBe("victim-head");
    expect(victim.title).toBe("Victim review");

    const [created] = await db<{ user_id: string; org_id: string }[]>`
      SELECT user_id, org_id FROM bookmarks WHERE id = ${body.id}
    `;
    expect(created.user_id).toBe(attackerUserId);
    expect(created.org_id).toBe(attackerOrg.id);
  });
});
