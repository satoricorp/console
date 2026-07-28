import { beforeAll, expect, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import app from "../src/app";
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
    [7710, installationId, "satoricorp/gx", "installed", null],
    [7711, installationId, "SatoriCorp/Console", "installed", null],
    // Access was removed: connecting once must not be permanent.
    [7712, installationId, "satoricorp/yeet", "removed", null],
    [7713, installationId, "satoricorp/old", "installed", String(now)],
    // A different organization's repository.
    [7714, otherInstallationId, "acme/secrets", "installed", null],
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
    expect(origins).toEqual(["github.com/satoricorp/console", "github.com/satoricorp/gx"]);
    expect(body.repos.map((r) => r.fullName).sort()).toEqual(["SatoriCorp/Console", "satoricorp/gx"]);
  });

  test("omits repositories whose access was removed", async () => {
    const { body } = await connectedRepos(orgId);
    const origins = body.repos.map((r) => r.origin);
    // Connecting once must not be permanent: revoking access has to actually
    // stop the indexing, by both the access_state and removed_at_ms routes.
    expect(origins).not.toContain("github.com/satoricorp/yeet");
    expect(origins).not.toContain("github.com/satoricorp/old");
  });

  test("never returns another organization's repositories", async () => {
    const { body } = await connectedRepos(orgId);
    expect(body.repos.map((r) => r.origin)).not.toContain("github.com/acme/secrets");

    // And the other org sees only its own.
    const other = await connectedRepos(otherOrgId);
    expect(other.body.repos.map((r) => r.origin)).toEqual(["github.com/acme/secrets"]);
  });

  test("returns nothing for an installation that is suspended", async () => {
    const sql = getSql();
    await sql`UPDATE orgs SET installation_id = ${suspendedInstallationId} WHERE id = ${orgId}`;
    await sql`
      INSERT INTO github_app_repositories (
        github_repo_id, installation_id, full_name, owner_login, name,
        private, default_branch, access_state, updated_at_ms
      )
      VALUES (7715, ${suspendedInstallationId}, 'satoricorp/suspended', 'satoricorp', 'suspended',
              true, 'main', 'installed', ${Date.now()})
      ON CONFLICT (github_repo_id) DO NOTHING
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
