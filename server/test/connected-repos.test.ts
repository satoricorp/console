import { beforeAll, expect, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import app from "../src/app";
import { listConnectedRepos } from "../src/routes/connected-repos";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb, hasDatabase as hasDb } from "./db-gate";

const orgId = "00000000-0000-4000-8000-000000000771";
const otherOrgId = "00000000-0000-4000-8000-000000000772";
const installationId = 771001;
const otherInstallationId = 771002;
const suspendedInstallationId = 771003;

async function seed() {
  const sql = getSql();
  const now = Date.now();

  for (const [id, suspended] of [
    [installationId, null],
    [otherInstallationId, null],
    [suspendedInstallationId, now],
  ] as Array<[number, number | null]>) {
    await sql`
      INSERT INTO github_app_installations (installation_id, account_login, suspended_at_ms, updated_at_ms)
      VALUES (${id}, ${"acct-" + id}, ${suspended}, ${now})
      ON CONFLICT (installation_id) DO UPDATE SET suspended_at_ms = EXCLUDED.suspended_at_ms
    `;
  }

  await sql`
    INSERT INTO orgs (id, installation_id, plan, created_at_ms)
    VALUES (${orgId}, ${installationId}, 'free', ${now})
    ON CONFLICT (id) DO UPDATE SET installation_id = EXCLUDED.installation_id
  `;
  await sql`
    INSERT INTO orgs (id, installation_id, plan, created_at_ms)
    VALUES (${otherOrgId}, ${otherInstallationId}, 'free', ${now})
    ON CONFLICT (id) DO UPDATE SET installation_id = EXCLUDED.installation_id
  `;

  const repos: Array<[number, number, string, string, string | null]> = [
    // Connected to this org.
    [7710, installationId, "connectedfixture/alpha", "installed", null],
    [7711, installationId, "ConnectedFixture/Beta", "installed", null],
    // Access was removed: connecting once must not be permanent.
    [7712, installationId, "connectedfixture/removed", "removed", null],
    [7713, installationId, "connectedfixture/gone", "installed", String(now)],
    // A different organization's repository.
    [7714, otherInstallationId, "connectedother/secrets", "installed", null],
  ];
  for (const [repoId, install, fullName, state, removedAt] of repos) {
    const [owner, name] = fullName.split("/");
    await sql`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        private, default_branch, access_state, removed_at_ms, updated_at_ms
      )
      VALUES (
        ${repoId}, ${install}, ${fullName}, ${owner}, ${name},
        true, 'main', ${state}, ${removedAt}, ${now}
      )
      ON CONFLICT (github_repo_id) DO UPDATE SET
        installation_id = EXCLUDED.installation_id,
        full_name = EXCLUDED.full_name,
        owner_login = EXCLUDED.owner_login,
        name = EXCLUDED.name,
        access_state = EXCLUDED.access_state,
        removed_at_ms = EXCLUDED.removed_at_ms
    `;
  }
}

if (hasDb) {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    installTestAuth();
    await runMigrations();
    await seed();
  });
}

async function connectedRepos(org: string) {
  const response = await app.request("/v1/connected-repos", {
    headers: authHeaders("user-1", org),
  });
  return { status: response.status, body: (await response.json()) as { repos: Array<Record<string, unknown>> } };
}

describeDb("connected repos API", () => {
  test("lists the org's connected repositories with a normalized origin", async () => {
    const { status, body } = await connectedRepos(orgId);
    expect(status).toBe(200);

    const origins = body.repos.map((r) => r.origin).sort();
    // Lowercased regardless of how GitHub spells the owner or repo, because
    // this is compared against a normalized local remote URL.
    expect(origins).toEqual(["github.com/connectedfixture/alpha", "github.com/connectedfixture/beta"]);
    expect(body.repos.map((r) => r.fullName).sort()).toEqual(["ConnectedFixture/Beta", "connectedfixture/alpha"]);
  });

  test("omits repositories whose access was removed", async () => {
    const { body } = await connectedRepos(orgId);
    const origins = body.repos.map((r) => r.origin);
    // Connecting once must not be permanent: revoking access has to actually
    // stop the indexing, by both the access_state and removed_at_ms routes.
    expect(origins).not.toContain("github.com/connectedfixture/removed");
    expect(origins).not.toContain("github.com/connectedfixture/gone");
  });

  test("never returns another organization's repositories", async () => {
    const { body } = await connectedRepos(orgId);
    expect(body.repos.map((r) => r.origin)).not.toContain("github.com/connectedother/secrets");

    // And the other org sees only its own.
    const other = await connectedRepos(otherOrgId);
    expect(other.body.repos.map((r) => r.origin)).toEqual(["github.com/connectedother/secrets"]);
  });

  test("returns nothing for an installation that is suspended", async () => {
    const sql = getSql();
    await sql`UPDATE orgs SET installation_id = ${suspendedInstallationId} WHERE id = ${orgId}`;
    await sql`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        private, default_branch, access_state, updated_at_ms
      )
      VALUES (7715, ${suspendedInstallationId}, 'connectedfixture/suspended', 'connectedfixture', 'suspended',
              true, 'main', 'installed', ${Date.now()})
      ON CONFLICT (github_repo_id) DO UPDATE SET
        installation_id = EXCLUDED.installation_id,
        full_name = EXCLUDED.full_name,
        access_state = EXCLUDED.access_state
    `;
    try {
      const { body } = await connectedRepos(orgId);
      expect(body.repos).toEqual([]);
    } finally {
      await sql`UPDATE orgs SET installation_id = ${installationId} WHERE id = ${orgId}`;
    }
  });

  test("returns an empty list for an org with nothing connected", async () => {
    // The auth layer always resolves some org, so this exercises the query
    // rather than the empty-orgId guard: an organization that has connected
    // nothing gets an empty list, never a fallback to something broader.
    const { status, body } = await connectedRepos("00000000-0000-4000-8000-0000000007ff");
    expect(status).toBe(200);
    expect(body.repos).toEqual([]);
  });
});


// A GitHub App is installed per account, so somebody with a personal
// installation and an organization installation has two orgs — orgs.installation_id
// is unique, so each installation makes its own row. Org resolution takes the
// oldest membership and stops, which answers with whichever they connected
// first and hides the rest. The personal install is usually older, so the
// organization repositories they actually work in are the ones hidden.
//
// Membership is the boundary that spans them, and it is already maintained:
// installing on an organization syncs an org_members row for every member.
//
// These call listConnectedRepos directly rather than going through the auth
// middleware. Reaching it that way needs a test to stub global fetch and
// NODE_ENV, and that leaks across files — doing it that way broke five tests
// elsewhere that had nothing to do with this route.
const memberGithubUserId = 771234;

async function joinOrgs(orgs: string[]) {
  const sql = getSql();
  await sql`DELETE FROM org_members WHERE github_user_id = ${memberGithubUserId}`;
  for (const org of orgs) {
    await sql`
      INSERT INTO org_members (org_id, github_user_id, role, source, created_at_ms)
      VALUES (${org}::uuid, ${memberGithubUserId}, 'member', 'github_sync', ${Date.now()})
      ON CONFLICT (org_id, github_user_id) DO NOTHING
    `;
  }
}

describeDb("connected repos across every org a user belongs to", () => {
  test("spans every org the caller is a member of, not just the resolved one", async () => {
    await joinOrgs([orgId, otherOrgId]);
    // The resolved org names only the first; the second must still appear,
    // because the caller belongs to it.
    const repos = await listConnectedRepos(getSql(), {
      orgId,
      githubUserId: memberGithubUserId,
    });
    expect(repos.map((r) => r.origin).sort()).toEqual([
      "github.com/connectedfixture/alpha",
      "github.com/connectedfixture/beta",
      "github.com/connectedother/secrets",
    ]);
    await joinOrgs([]);
  });

  test("membership is still the boundary", async () => {
    await joinOrgs([otherOrgId]);
    const repos = await listConnectedRepos(getSql(), {
      orgId: "",
      githubUserId: memberGithubUserId,
    });
    // Spanning orgs must not mean spanning every org.
    expect(repos.map((r) => r.origin)).toEqual(["github.com/connectedother/secrets"]);
    await joinOrgs([]);
  });

  test("a caller with no memberships still sees the resolved org", async () => {
    await joinOrgs([]);
    const repos = await listConnectedRepos(getSql(), {
      orgId,
      githubUserId: memberGithubUserId,
    });
    expect(repos.map((r) => r.origin).sort()).toEqual([
      "github.com/connectedfixture/alpha",
      "github.com/connectedfixture/beta",
    ]);
  });

  test("no org and no identity returns nothing", async () => {
    const repos = await listConnectedRepos(getSql(), { orgId: "", githubUserId: null });
    expect(repos).toEqual([]);
  });
});
