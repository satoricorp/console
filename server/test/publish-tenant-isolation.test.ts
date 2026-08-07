import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { findInstalledRepositoryForOrg } from "../src/github/app";
import { setOrgMemberCheckForTests } from "../src/orgs/members";
import { installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

/**
 * The org a publish lands in is derived from a repo name in the request body.
 * These cover the part that decides whether the caller may write there.
 *
 * The attack the check exists for: any authenticated gx user names a repo
 * belonging to an org they are not in. Before the membership check the server
 * resolved that repo's installation, discarded the caller's own org, and filed
 * the events, the bookmark and the indexed session text under the victim —
 * then handed the reconcile and PR-summary steps the victim's installation
 * token, which edits the body of a real pull request.
 */
describeDb("publish tenant isolation", () => {
  const originalFetch = globalThis.fetch;
  const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  const attackerGithubUserId = 4242;

  beforeAll(async () => {
    // A cloud API key is configured, but the caller below does not hold it:
    // they authenticate as an ordinary CLI user, which is the threat model.
    installTestAuth();
    process.env.CONVEX_SITE_URL = "https://convex.example";
    delete process.env.OPENAI_API_KEY;
    await runMigrations();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalConvexSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
    }
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setOrgMemberCheckForTests(null);
  });

  /**
   * A repo installed by one org, plus a second org the caller belongs to.
   * Returns both org ids and the installed repo's full name.
   */
  async function seedVictimRepoAndAttackerOrg() {
    const db = getSql();
    const now = Date.now();
    const installationId = Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
    const victimRepo = `victim-co/private-${crypto.randomUUID()}`;

    await db`
      INSERT INTO github_app_installations (
        installation_id, account_login, account_type, updated_at_ms, installed_at_ms
      ) VALUES (
        ${installationId}, 'victim-co', 'Organization', ${now}, ${now}
      )
      ON CONFLICT (installation_id) DO NOTHING
    `;
    const [victimOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${installationId}, 'free', ${now})
      ON CONFLICT (installation_id) DO UPDATE SET plan = EXCLUDED.plan
      RETURNING id
    `;
    const [attackerOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${now})
      RETURNING id
    `;
    await db`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        access_state, updated_at_ms, added_at_ms
      ) VALUES (
        ${Math.floor(Math.random() * 1_000_000_000) + 2_000_000},
        ${installationId},
        ${victimRepo},
        'victim-co',
        'private',
        'installed',
        ${now},
        ${now}
      )
    `;

    return { victimOrgId: victimOrg.id, attackerOrgId: attackerOrg.id, victimRepo };
  }

  /**
   * Authenticate as a gx CLI session, and record every outbound call so the
   * test can assert GitHub was never touched.
   */
  function installCliSessionAuth() {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url === "https://convex.example/cx/auth/cli/verify") {
        return new Response(
          JSON.stringify({
            session_id: "session_attacker",
            user_id: "user_attacker",
            github_user_id: attackerGithubUserId,
            github_login: "attacker",
            machine_id: "machine_attacker",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    return calls;
  }

  function publishBundle(repoFullName: string, branchName: string) {
    const now = Date.now();
    return {
      event: "gx.pr",
      schema_version: 1,
      created_at: now,
      gx_version: "test",
      repo: {
        root_path: "/tmp/attacker-checkout",
        backend: "git",
        default_branch: "main",
        remote_url: `https://github.com/${repoFullName}.git`,
        branch_name: branchName,
      },
      push: {
        branch_name: branchName,
        head_commit_id: "attacker-head",
      },
      revisions: [
        {
          branch_name: branchName,
          base_branch_name: "main",
          patch: "diff --git a/a.ts b/a.ts\n",
          description: "Please merge this",
          files: ["a.ts"],
        },
      ],
      sessions: [],
    };
  }

  test("rejects a publish aimed at an org the caller does not belong to", async () => {
    const db = getSql();
    const { victimOrgId, attackerOrgId, victimRepo } =
      await seedVictimRepoAndAttackerOrg();
    const calls = installCliSessionAuth();
    setOrgMemberCheckForTests(async (orgId) => orgId === attackerOrgId);

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        Authorization: "Bearer gxcs_attacker",
        "X-Org-Id": attackerOrgId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(publishBundle(victimRepo, "feature/steal")),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: `You are not a member of the organization that owns ${victimRepo} on gx`,
    });

    // Nothing was filed under the victim, and nothing under the attacker
    // either — the publish is refused, not redirected.
    const events = await db<{ id: string }[]>`
      SELECT id FROM pr_events WHERE org_id IN (${victimOrgId}, ${attackerOrgId})
    `;
    expect(events).toHaveLength(0);
    const bookmarks = await db<{ id: string }[]>`
      SELECT id FROM bookmarks WHERE repo_full_name = ${victimRepo}
    `;
    expect(bookmarks).toHaveLength(0);

    // No installation token was minted and no pull request was touched.
    expect(calls.filter((url) => url.includes("api.github.com"))).toEqual([]);
  });

  test("rejects a publish registration aimed at another org", async () => {
    const db = getSql();
    const { victimOrgId, attackerOrgId, victimRepo } =
      await seedVictimRepoAndAttackerOrg();
    installCliSessionAuth();
    setOrgMemberCheckForTests(async (orgId) => orgId === attackerOrgId);

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        Authorization: "Bearer gxcs_attacker",
        "X-Org-Id": attackerOrgId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo_full_name: victimRepo,
        branch_name: "feature/steal",
        head_commit_id: "attacker-head",
      }),
    });

    expect(res.status).toBe(403);
    const bookmarks = await db<{ id: string }[]>`
      SELECT id FROM bookmarks WHERE org_id = ${victimOrgId}
    `;
    expect(bookmarks).toHaveLength(0);
  });

  test("still files a member's publish under the org that installed the repo", async () => {
    const db = getSql();
    const { victimOrgId, attackerOrgId, victimRepo } =
      await seedVictimRepoAndAttackerOrg();
    installCliSessionAuth();
    // This caller belongs to both orgs, which is the ordinary case: a CLI
    // session whose org resolved to a personal org publishing into the org
    // that installed the App. The retarget is what makes that work.
    setOrgMemberCheckForTests(async () => true);

    const res = await app.request("http://localhost/v1/publish", {
      method: "POST",
      headers: {
        Authorization: "Bearer gxcs_member",
        "X-Org-Id": attackerOrgId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(publishBundle(victimRepo, "feature/legit")),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const [bookmark] = await db<{ org_id: string }[]>`
      SELECT org_id FROM bookmarks WHERE id = ${body.id}
    `;
    expect(bookmark.org_id).toBe(victimOrgId);
  });

  test("an installation grant only resolves for the org that owns it", async () => {
    const db = getSql();
    const { victimOrgId, attackerOrgId, victimRepo } =
      await seedVictimRepoAndAttackerOrg();

    // This is the lookup that becomes an installation access token in the
    // reconcile and PR-summary steps.
    const owner = await findInstalledRepositoryForOrg(db, victimOrgId, victimRepo);
    expect(owner?.repoFullName).toBe(victimRepo);

    const stranger = await findInstalledRepositoryForOrg(
      db,
      attackerOrgId,
      victimRepo,
    );
    expect(stranger).toBeNull();
  });
});
