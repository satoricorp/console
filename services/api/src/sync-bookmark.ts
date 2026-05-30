import { ingestCliBookmark, ingestDevBookmark } from "./convex-client";
import type { AuthContext, BookmarkSyncPayload } from "./types";

type BookmarkRowLike = {
  id: string;
  latest_event_id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  merge_status: "open" | "merged" | "closed";
  github_pr_url: string | null;
  github_pr_number: number | null;
  head_commit_id: string | null;
  remote_head_sha: string | null;
  updated_at_ms: string;
};

export function bookmarkRowToSyncPayload(row: BookmarkRowLike): BookmarkSyncPayload {
  return {
    postgresBookmarkId: row.id,
    latestEventId: row.latest_event_id,
    repoFullName: row.repo_full_name,
    branchName: row.branch_name,
    title: row.title,
    revision: row.revision,
    mergeStatus: row.merge_status,
    githubPrUrl: row.github_pr_url,
    githubPrNumber: row.github_pr_number,
    headCommitId: row.head_commit_id,
    remoteHeadSha: row.remote_head_sha,
    updatedAt: Number(row.updated_at_ms),
  };
}

export async function syncBookmarkToConvex(
  row: BookmarkRowLike,
  auth: AuthContext,
  cliToken?: string,
): Promise<void> {
  const bookmark = bookmarkRowToSyncPayload(row);
  const devKey = process.env.GX_CLOUD_API_KEY?.trim();
  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();

  if (devKey && cliToken === devKey && webhookSecret) {
    await ingestDevBookmark(
      webhookSecret,
      auth.userId,
      auth.sessionId,
      bookmark,
    );
    return;
  }

  if (!cliToken) {
    throw new Error("Missing CLI token for Convex bookmark sync");
  }

  await ingestCliBookmark(cliToken, bookmark);
}
