import type postgres from "postgres";
import type { AuthContext, BookmarkSyncPayload, PushBundle } from "./types";
import { parseGithubPrNumber, repoFullNameFromRemoteUrl } from "./bookmark-utils";
import { extractIndexFields } from "./validate-payload";

type SqlClient = postgres.Sql | postgres.TransactionSql;

type IngestEventInput = {
  tx: SqlClient;
  auth: AuthContext;
  payload: PushBundle;
  repoFullName: string;
  branchName: string;
  headCommitId: string;
  remoteHeadSha?: string | null;
  preserveTitle?: string | null;
};

type IngestEventResult = {
  eventId: string;
  bookmark: BookmarkSyncPayload;
};

export async function ingestBookmarkEvent(
  input: IngestEventInput,
): Promise<IngestEventResult> {
  const indexFields = extractIndexFields(input.payload);
  const githubPrNumber = parseGithubPrNumber(indexFields.github_pr_url);

  const [eventRow] = await input.tx<{ id: string }[]>`
    INSERT INTO gx_pr_events (
      event,
      created_at_ms,
      gx_version,
      user_id,
      session_id,
      machine_id,
      github_user_id,
      github_user_login,
      repo_root_path,
      repo_backend,
      remote_url,
      branch_name,
      head_commit_id,
      github_pr_url,
      payload
    ) VALUES (
      ${input.payload.event},
      ${input.payload.created_at},
      ${input.payload.gx_version},
      ${input.auth.userId},
      ${input.auth.sessionId},
      ${input.auth.machineId},
      ${input.auth.githubUserId},
      ${input.auth.githubUserLogin},
      ${indexFields.repo_root_path},
      ${indexFields.repo_backend},
      ${indexFields.remote_url},
      ${indexFields.branch_name},
      ${input.headCommitId},
      ${indexFields.github_pr_url},
      ${input.tx.json(input.payload)}
    )
    RETURNING id
  `;

  const [bookmarkRow] = await input.tx<
    {
      id: string;
      latest_event_id: string;
      title: string | null;
      revision: number;
      merge_status: "open" | "merged" | "closed";
      github_pr_url: string | null;
      github_pr_number: number | null;
      head_commit_id: string | null;
      remote_head_sha: string | null;
      updated_at_ms: string;
    }[]
  >`
    UPDATE gx_bookmarks
    SET
      revision = gx_bookmarks.revision + 1,
      latest_event_id = ${eventRow.id},
      head_commit_id = ${input.headCommitId},
      github_pr_url = COALESCE(${indexFields.github_pr_url}, gx_bookmarks.github_pr_url),
      github_pr_number = COALESCE(${githubPrNumber}, gx_bookmarks.github_pr_number),
      remote_head_sha = COALESCE(${input.remoteHeadSha ?? null}, gx_bookmarks.remote_head_sha),
      updated_at_ms = ${input.payload.created_at},
      title = COALESCE(gx_bookmarks.title, ${input.preserveTitle ?? null})
    WHERE id = (
      SELECT id
      FROM gx_bookmarks
      WHERE user_id = ${input.auth.userId}
        AND repo_full_name = ${input.repoFullName}
        AND branch_name = ${input.branchName}
      LIMIT 1
    )
    RETURNING
      id,
      latest_event_id,
      title,
      revision,
      merge_status,
      github_pr_url,
      github_pr_number,
      head_commit_id,
      remote_head_sha,
      updated_at_ms
  `;

  if (!bookmarkRow) {
    throw new Error("Bookmark not found during event ingest");
  }

  return {
    eventId: eventRow.id,
    bookmark: {
      postgresBookmarkId: bookmarkRow.id,
      latestEventId: bookmarkRow.latest_event_id,
      repoFullName: input.repoFullName,
      branchName: input.branchName,
      title: bookmarkRow.title,
      revision: bookmarkRow.revision,
      mergeStatus: bookmarkRow.merge_status,
      githubPrUrl: bookmarkRow.github_pr_url,
      githubPrNumber: bookmarkRow.github_pr_number,
      headCommitId: bookmarkRow.head_commit_id,
      remoteHeadSha: bookmarkRow.remote_head_sha,
      updatedAt: Number(bookmarkRow.updated_at_ms),
      latestPayload: input.payload,
    },
  };
}

export function resolveRepoFullName(
  auth: AuthContext,
  payload: PushBundle,
): string {
  const indexFields = extractIndexFields(payload);
  return (
    repoFullNameFromRemoteUrl(indexFields.remote_url) ??
    `${auth.githubUserLogin}/${indexFields.repo_root_path.split("/").at(-1) ?? "repo"}`
  );
}

export function resolveBranchName(payload: PushBundle): string {
  const indexFields = extractIndexFields(payload);
  return (
    indexFields.branch_name ??
    payload.repo.branch_name ??
    payload.push.branch_name ??
    "unknown"
  );
}
