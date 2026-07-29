import type postgres from "postgres";
import type { PushBundle } from "../types";
import { publishRevisions } from "./revisions";

export type SqlExecutor = postgres.Sql | postgres.TransactionSql;

/**
 * Latest transcript text per session named in the bundle, from sessions_raw.
 *
 * The pre-push hook uploads transcripts through POST /v1/sessions before the
 * publish call, so by the time the artifact is indexed the content is already
 * here; the bundle itself only names the sessions. Latest row per session:
 * a session can be re-captured on a re-push and the newest capture is the one
 * that matches the published head.
 */
export async function loadPublishedSessionTexts(
  db: SqlExecutor,
  orgId: string,
  payload: PushBundle,
): Promise<Record<string, { tool?: string; content: string }>> {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const ids = [
    ...new Set(
      sessions.flatMap((session) =>
        session && typeof session === "object" && typeof (session as { id?: unknown }).id === "string"
          ? [(session as { id: string }).id]
          : [],
      ),
    ),
  ];
  if (ids.length === 0) {
    return {};
  }
  const rows = await db<Array<{ session_id: string; tool: string | null; content: string }>>`
    SELECT DISTINCT ON (session_id) session_id, tool, content
    FROM sessions_raw
    WHERE org_id = ${orgId} AND session_id = ANY(${ids})
    ORDER BY session_id, captured_at_ms DESC
  `;
  const out: Record<string, { tool?: string; content: string }> = {};
  for (const row of rows) {
    out[row.session_id] = { tool: row.tool ?? undefined, content: row.content };
  }
  return out;
}

export type BookmarkRow = {
  id: string;
  user_id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  latest_event_id: string | null;
  head_commit_id: string | null;
  github_pr_url: string | null;
  github_pr_number: number | null;
  remote_head_sha: string | null;
  merge_status: "open" | "merged" | "closed";
  published_at_ms: string;
  updated_at_ms: string;
  storage_backend: string;
};

export async function upsertBookmark(
  tx: SqlExecutor,
  args: {
    orgId: string;
    userId: string;
    requestedId: string | null;
    repoFullName: string;
    branchName: string;
    title: string;
    eventId: string | null;
    headCommitId: string;
    githubPrUrl: string | null;
    githubPrNumber: number | null;
    remoteHeadSha: string | null;
    updatedAtMs: number;
  },
): Promise<BookmarkRow> {
  if (!args.requestedId && args.githubPrNumber !== null) {
    const [existingPrBookmark] = await tx<BookmarkRow[]>`
      UPDATE bookmarks
      SET
        org_id = ${args.orgId},
        branch_name = ${args.branchName},
        title = COALESCE(bookmarks.title, ${args.title}),
        revision = bookmarks.revision + 1,
        latest_event_id = COALESCE(${args.eventId}, bookmarks.latest_event_id),
        head_commit_id = ${args.headCommitId},
        github_pr_url = COALESCE(${args.githubPrUrl}, bookmarks.github_pr_url),
        remote_head_sha = COALESCE(${args.remoteHeadSha}, bookmarks.remote_head_sha),
        updated_at_ms = ${args.updatedAtMs}
      WHERE user_id = ${args.userId}
        AND repo_full_name = ${args.repoFullName}
        AND github_pr_number = ${args.githubPrNumber}
      RETURNING *
    `;
    if (existingPrBookmark) {
      return existingPrBookmark;
    }
  }

  if (args.requestedId) {
    const [row] = await tx<BookmarkRow[]>`
      INSERT INTO bookmarks (
        id,
        org_id,
        user_id,
        repo_full_name,
        branch_name,
        title,
        latest_event_id,
        head_commit_id,
        github_pr_url,
        github_pr_number,
        remote_head_sha,
        updated_at_ms,
        published_at_ms
      ) VALUES (
        ${args.requestedId},
        ${args.orgId},
        ${args.userId},
        ${args.repoFullName},
        ${args.branchName},
        ${args.title},
        ${args.eventId},
        ${args.headCommitId},
        ${args.githubPrUrl},
        ${args.githubPrNumber},
        ${args.remoteHeadSha},
        ${args.updatedAtMs},
        ${args.updatedAtMs}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        org_id = EXCLUDED.org_id,
        user_id = EXCLUDED.user_id,
        repo_full_name = EXCLUDED.repo_full_name,
        branch_name = EXCLUDED.branch_name,
        revision = bookmarks.revision + 1,
        latest_event_id = COALESCE(EXCLUDED.latest_event_id, bookmarks.latest_event_id),
        head_commit_id = EXCLUDED.head_commit_id,
        github_pr_url = COALESCE(EXCLUDED.github_pr_url, bookmarks.github_pr_url),
        github_pr_number = COALESCE(EXCLUDED.github_pr_number, bookmarks.github_pr_number),
        remote_head_sha = COALESCE(EXCLUDED.remote_head_sha, bookmarks.remote_head_sha),
        title = COALESCE(bookmarks.title, EXCLUDED.title),
        updated_at_ms = EXCLUDED.updated_at_ms
      RETURNING *
    `;
    if (!row) throw new Error("Failed to upsert bookmark");
    return row;
  }

  const [row] = await tx<BookmarkRow[]>`
    INSERT INTO bookmarks (
      org_id,
      user_id,
      repo_full_name,
      branch_name,
      title,
      latest_event_id,
      head_commit_id,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      updated_at_ms,
      published_at_ms
    ) VALUES (
      ${args.orgId},
      ${args.userId},
      ${args.repoFullName},
      ${args.branchName},
      ${args.title},
      ${args.eventId},
      ${args.headCommitId},
      ${args.githubPrUrl},
      ${args.githubPrNumber},
      ${args.remoteHeadSha},
      ${args.updatedAtMs},
      ${args.updatedAtMs}
    )
    ON CONFLICT (user_id, repo_full_name, branch_name)
    DO UPDATE SET
      org_id = EXCLUDED.org_id,
      revision = bookmarks.revision + 1,
      latest_event_id = COALESCE(EXCLUDED.latest_event_id, bookmarks.latest_event_id),
      head_commit_id = EXCLUDED.head_commit_id,
      github_pr_url = COALESCE(EXCLUDED.github_pr_url, bookmarks.github_pr_url),
      github_pr_number = COALESCE(EXCLUDED.github_pr_number, bookmarks.github_pr_number),
      remote_head_sha = COALESCE(EXCLUDED.remote_head_sha, bookmarks.remote_head_sha),
      title = COALESCE(bookmarks.title, EXCLUDED.title),
      updated_at_ms = EXCLUDED.updated_at_ms
    RETURNING *
  `;
  if (!row) throw new Error("Failed to upsert bookmark");
  return row;
}

function collectPublishFiles(payload: PushBundle): string[] {
  const files = new Set<string>();
  for (const file of payload.change?.files ?? []) {
    const trimmed = file.trim();
    if (trimmed) files.add(trimmed);
  }
  for (const revision of publishRevisions(payload)) {
    for (const file of revision.files ?? []) {
      const trimmed = file.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  return [...files];
}

export async function refreshBookmarkAppFields(
  db: postgres.Sql,
  bookmarkId: string,
  payload: PushBundle,
) {
  const files = collectPublishFiles(payload);
  const revisions = publishRevisions(payload);
  const stackCount = revisions.length;
  const baseBranch =
    revisions.find((revision) => revision.base_branch_name?.trim())?.base_branch_name?.trim() ||
    payload.repo.default_branch?.trim() ||
    "main";

  await db`
    UPDATE bookmarks
    SET app_file_count = ${files.length},
        app_stack_count = ${stackCount},
        app_base_branch = ${baseBranch}
    WHERE id = ${bookmarkId}
  `;
}
