import type postgres from "postgres";
import { enqueueIndexJob } from "../indexing/jobs";
import { bootstrapInstallationMembership } from "../orgs/members";
import { resolveOrgIdForInstallation } from "./app";
import type { GitHubInstallation, GitHubRepository, WebhookPayload } from "./webhook";

export async function handleInstallation(db: postgres.Sql, payload: WebhookPayload) {
  const installation = normalizeInstallation(payload.installation);
  if (!installation) return;

  const now = Date.now();
  const action = payload.action ?? "";
  const removed = action === "deleted";
  const senderGithubUserId =
    typeof payload.sender?.id === "number" ? payload.sender.id : null;

  await db.begin(async (tx) => {
    await upsertInstallation(tx, installation, now);

    if (removed) {
      await tx`
        UPDATE github_app_repositories
        SET access_state = 'removed',
            removed_at_ms = ${now},
            updated_at_ms = ${now}
        WHERE installation_id = ${installation.installationId}
      `;
      return;
    }

    await upsertOrgForInstallation(tx, installation.installationId, now);

    for (const repo of payload.repositories ?? []) {
      const normalized = normalizeRepository(repo, installation.installationId);
      if (normalized) {
        await upsertRepository(tx, normalized, now);
      }
    }
  });

  if (!removed) {
    const orgId = await resolveOrgIdForInstallation(db, installation.installationId);
    if (orgId) {
      await bootstrapInstallationMembership(db, {
        orgId,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        accountId: installation.accountId,
        senderGithubUserId,
      });
      for (const repo of payload.repositories ?? []) {
        if (!repo.full_name) continue;
        enqueueIndexJob({
          orgId,
          repoFullName: repo.full_name,
          reason: "install",
          ref: repo.default_branch ? `refs/heads/${repo.default_branch}` : undefined,
        });
      }
    }
  }
}

export async function handleInstallationRepositories(
  db: postgres.Sql,
  payload: WebhookPayload,
) {
  const installation = normalizeInstallation(payload.installation);
  if (!installation) return;

  const now = Date.now();
  await db.begin(async (tx) => {
    await upsertInstallation(tx, installation, now);
    await upsertOrgForInstallation(tx, installation.installationId, now);

    for (const repo of payload.repositories_added ?? []) {
      const normalized = normalizeRepository(repo, installation.installationId);
      if (normalized) {
        await upsertRepository(tx, normalized, now);
      }
    }

    for (const repo of payload.repositories_removed ?? []) {
      if (typeof repo.id !== "number") continue;
      await tx`
        UPDATE github_app_repositories
        SET access_state = 'removed',
            removed_at_ms = ${now},
            updated_at_ms = ${now}
        WHERE github_repo_id = ${repo.id}
      `;
    }
  });
}

async function upsertOrgForInstallation(
  tx: postgres.TransactionSql,
  installationId: number,
  now: number,
) {
  await tx`
    INSERT INTO orgs (installation_id, created_at_ms)
    VALUES (${installationId}, ${now})
    ON CONFLICT (installation_id) DO NOTHING
  `;
}

async function upsertInstallation(
  tx: postgres.TransactionSql,
  installation: NonNullable<ReturnType<typeof normalizeInstallation>>,
  now: number,
) {
  await tx`
    INSERT INTO github_app_installations (
      installation_id,
      account_id,
      account_login,
      account_type,
      repository_selection,
      app_id,
      installed_at_ms,
      suspended_at_ms,
      updated_at_ms
    ) VALUES (
      ${installation.installationId},
      ${installation.accountId},
      ${installation.accountLogin},
      ${installation.accountType},
      ${installation.repositorySelection},
      ${installation.appId},
      ${installation.installedAtMs},
      ${installation.suspendedAtMs},
      ${now}
    )
    ON CONFLICT (installation_id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      account_login = EXCLUDED.account_login,
      account_type = EXCLUDED.account_type,
      repository_selection = EXCLUDED.repository_selection,
      app_id = EXCLUDED.app_id,
      suspended_at_ms = EXCLUDED.suspended_at_ms,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

function normalizeInstallation(installation?: GitHubInstallation) {
  if (typeof installation?.id !== "number") return null;
  return {
    installationId: installation.id,
    accountId:
      typeof installation.account?.id === "number"
        ? installation.account.id
        : null,
    accountLogin: installation.account?.login ?? "",
    accountType: installation.account?.type ?? "",
    repositorySelection: installation.repository_selection ?? "",
    appId: typeof installation.app_id === "number" ? installation.app_id : null,
    installedAtMs: parseGitHubTimestamp(installation.created_at),
    suspendedAtMs: parseGitHubTimestamp(installation.suspended_at),
  };
}

function normalizeRepository(repo: GitHubRepository, installationId: number) {
  if (typeof repo.id !== "number" || !repo.full_name) return null;
  const [ownerLogin, nameFromFullName] = repo.full_name.split("/");
  return {
    githubRepoId: repo.id,
    installationId,
    fullName: repo.full_name,
    ownerLogin: repo.owner?.login ?? ownerLogin ?? "",
    name: repo.name ?? nameFromFullName ?? "",
    private: repo.private ?? null,
    defaultBranch: repo.default_branch ?? null,
  };
}

async function upsertRepository(
  tx: postgres.TransactionSql,
  repo: NonNullable<ReturnType<typeof normalizeRepository>>,
  now: number,
) {
  await tx`
    INSERT INTO github_app_repositories (
      github_repo_id,
      installation_id,
      full_name,
      owner_login,
      name,
      private,
      default_branch,
      access_state,
      added_at_ms,
      removed_at_ms,
      updated_at_ms
    ) VALUES (
      ${repo.githubRepoId},
      ${repo.installationId},
      ${repo.fullName},
      ${repo.ownerLogin},
      ${repo.name},
      ${repo.private},
      ${repo.defaultBranch},
      'installed',
      ${now},
      NULL,
      ${now}
    )
    ON CONFLICT (github_repo_id) DO UPDATE SET
      installation_id = EXCLUDED.installation_id,
      full_name = EXCLUDED.full_name,
      owner_login = EXCLUDED.owner_login,
      name = EXCLUDED.name,
      private = EXCLUDED.private,
      default_branch = EXCLUDED.default_branch,
      access_state = 'installed',
      removed_at_ms = NULL,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

function parseGitHubTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
