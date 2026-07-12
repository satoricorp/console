import type postgres from "postgres";
import { getInstallationAccessToken } from "../github/app";
import { getSql } from "../db";

export type OrgMemberRole = "admin" | "member";
export type OrgMemberSource =
  | "github_install"
  | "github_sync"
  | "invite"
  | "manual"
  | "backfill";

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

type MemberCheckFn = (orgId: string, githubUserId: number) => Promise<boolean>;

let memberCheckOverride: MemberCheckFn | null = null;

/** Test-only seam (mirrors setIndexingFetch). */
export function setOrgMemberCheckForTests(fn: MemberCheckFn | null): void {
  memberCheckOverride = fn;
}

export async function isOrgMember(
  db: SqlExecutor,
  orgId: string,
  githubUserId: number,
): Promise<boolean> {
  if (memberCheckOverride) {
    return memberCheckOverride(orgId, githubUserId);
  }
  const [row] = await db<{ ok: boolean }[]>`
    SELECT true AS ok
    FROM org_members
    WHERE org_id = ${orgId}::uuid
      AND github_user_id = ${githubUserId}
    LIMIT 1
  `;
  return Boolean(row);
}

export async function requireOrgMembership(
  orgId: string,
  githubUserId: number,
): Promise<boolean> {
  if (memberCheckOverride) {
    return memberCheckOverride(orgId, githubUserId);
  }
  return isOrgMember(getSql(), orgId, githubUserId);
}

export async function upsertOrgMember(
  db: SqlExecutor,
  args: {
    orgId: string;
    githubUserId: number;
    role?: OrgMemberRole;
    source: OrgMemberSource;
    convexUserId?: string | null;
    createdAtMs?: number;
  },
): Promise<void> {
  const now = args.createdAtMs ?? Date.now();
  const role = args.role ?? "member";
  await db`
    INSERT INTO org_members (
      org_id, github_user_id, convex_user_id, role, source, created_at_ms
    ) VALUES (
      ${args.orgId}::uuid,
      ${args.githubUserId},
      ${args.convexUserId ?? null},
      ${role},
      ${args.source},
      ${now}
    )
    ON CONFLICT (org_id, github_user_id) DO UPDATE SET
      convex_user_id = COALESCE(EXCLUDED.convex_user_id, org_members.convex_user_id),
      role = CASE
        WHEN org_members.role = 'admin' THEN org_members.role
        ELSE EXCLUDED.role
      END,
      source = org_members.source
  `;
}

export async function bootstrapInstallationMembership(
  db: SqlExecutor,
  args: {
    orgId: string;
    installationId: number;
    accountLogin: string;
    accountType: string;
    senderGithubUserId?: number | null;
  },
): Promise<void> {
  const now = Date.now();
  if (typeof args.senderGithubUserId === "number") {
    await upsertOrgMember(db, {
      orgId: args.orgId,
      githubUserId: args.senderGithubUserId,
      role: "admin",
      source: "github_install",
      createdAtMs: now,
    });
  }

  if (args.accountType.toLowerCase() !== "organization" || !args.accountLogin) {
    return;
  }

  try {
    const token = await getInstallationAccessToken(args.installationId);
    const members = await listGitHubOrgMembers(token, args.accountLogin);
    for (const member of members) {
      await upsertOrgMember(db, {
        orgId: args.orgId,
        githubUserId: member.id,
        role: member.id === args.senderGithubUserId ? "admin" : "member",
        source: "github_sync",
        createdAtMs: now,
      });
    }
  } catch (error) {
    console.warn("org member sync failed", {
      orgId: args.orgId,
      installationId: args.installationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function listGitHubOrgMembers(
  token: string,
  orgLogin: string,
): Promise<Array<{ id: number; login: string }>> {
  const out: Array<{ id: number; login: string }> = [];
  let page = 1;
  for (;;) {
    const response = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(orgLogin)}/members?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "gx-server",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`list org members failed (${response.status}): ${body.slice(0, 200)}`);
    }
    const batch = (await response.json()) as Array<{ id?: number; login?: string }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const row of batch) {
      if (typeof row.id === "number") {
        out.push({ id: row.id, login: row.login ?? "" });
      }
    }
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return out;
}

export function parseGithubUserIdFromAuth(userId: string): number | null {
  const match = /^github:(\d+)$/.exec(userId.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}
