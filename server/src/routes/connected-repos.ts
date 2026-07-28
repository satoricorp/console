import { Hono } from "hono";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";
import type postgres from "postgres";

export const connectedReposRoutes = new Hono<AppEnv>();

connectedReposRoutes.use("/v1/connected-repos", requireAuth);

/**
 * Lists the repositories this organization has connected.
 *
 * The CLI needs this to decide what an agent session may be indexed against.
 * It binds each session to the repository it ran in — working directory, then
 * git origin — but only the server knows which repositories an organization
 * actually connected. Without that list the CLI has to guess, and both guesses
 * are bad: too permissive ships sessions from a repository nobody connected,
 * too strict silently stops indexing.
 *
 * `origin` is the identity to compare against, normalized the same way the CLI
 * normalizes a local remote URL: host, owner, and repository, lowercased, with
 * no scheme, credentials, or `.git` suffix. Computing it here rather than
 * client-side keeps one definition of repository identity, and a GitHub App
 * repository is always on github.com.
 *
 * Connected means the app is installed on the repository and neither the
 * repository nor its installation has been removed or suspended. A repository
 * that loses access stops appearing, which is what makes revoking access
 * actually stop the indexing.
 *
 * The answer spans every organization the caller belongs to, not the single one
 * resolveOrgIdForGithubUser picks. A GitHub App is installed per account, so a
 * person with a personal installation and an organization installation has two
 * orgs, and each installation creates its own org row because orgs.installation_id
 * is unique. Resolution takes the oldest membership and stops there, which for
 * that person answers with whichever they happened to connect first and hides
 * the rest — the organization repositories they actually care about are the
 * ones most likely hidden, since the personal install usually came first.
 *
 * Membership is the right boundary and it is already maintained: installing on
 * an organization syncs an org_members row for every member of it.
 */
connectedReposRoutes.get("/v1/connected-repos", async (c) => {
  const auth = c.get("auth");
  const repos = await listConnectedRepos(getSql(), {
    orgId: auth.orgId?.trim() ?? "",
    githubUserId: typeof auth.githubUserId === "number" ? auth.githubUserId : null,
  });
  return c.json({ repos });
});

export type ConnectedRepo = {
  fullName: string;
  origin: string;
  ownerLogin: string;
  name: string;
  defaultBranch: string;
  private: boolean;
};

/**
 * Lists the connected repositories visible to one caller.
 *
 * Exported and taking its database and identity as arguments so it can be
 * tested directly. Reaching it through the auth middleware would mean a test
 * stubbing global fetch and NODE_ENV, and that leaks: doing it that way broke
 * five tests in other files that had nothing to do with this route.
 */
export async function listConnectedRepos(
  db: postgres.Sql | postgres.TransactionSql,
  caller: { orgId: string; githubUserId: number | null },
): Promise<ConnectedRepo[]> {
  const { orgId, githubUserId } = caller;
  if (!orgId && githubUserId === null) {
    // Neither an organization nor an identity to find one by. Empty is the
    // honest answer and the safe one: the caller indexes nothing rather than
    // falling back to something broader.
    return [];
  }

  const rows = await db<
    Array<{
      full_name: string;
      owner_login: string;
      name: string;
      default_branch: string | null;
      private: boolean | null;
    }>
  >`
    SELECT r.full_name, r.owner_login, r.name, r.default_branch, r.private
    FROM github_app_repositories r
    JOIN github_app_installations i
      ON i.installation_id = r.installation_id
    JOIN orgs o
      ON o.installation_id = i.installation_id
    WHERE (
        (${orgId || null}::uuid IS NOT NULL AND o.id = ${orgId || null}::uuid)
        OR (
          ${githubUserId}::bigint IS NOT NULL
          AND o.id IN (
            SELECT m.org_id FROM org_members m WHERE m.github_user_id = ${githubUserId}
          )
        )
      )
      AND r.access_state = 'installed'
      AND r.removed_at_ms IS NULL
      AND i.suspended_at_ms IS NULL
    ORDER BY r.full_name ASC
  `;

  return rows.map((row) => ({
    fullName: row.full_name,
    origin: normalizeGitHubOrigin(row.full_name),
    ownerLogin: row.owner_login,
    name: row.name,
    defaultBranch: row.default_branch ?? "",
    private: row.private ?? false,
  }));
}

/**
 * Renders a GitHub `owner/repo` as the canonical origin the CLI compares
 * against. Kept deliberately dumb: every spelling difference that matters —
 * ssh versus https, a `.git` suffix, credentials, case — is resolved on the
 * client before comparison, and the only job here is to agree on the shape.
 */
export function normalizeGitHubOrigin(fullName: string): string {
  const trimmed = fullName.trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!trimmed) return "";
  return `github.com/${trimmed}`.toLowerCase();
}
