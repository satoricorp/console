export type BookmarkRow = {
  id: string;
  user_id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  latest_event_id: string;
  head_commit_id: string | null;
  github_pr_url: string | null;
  github_pr_number: number | null;
  remote_head_sha: string | null;
  merge_status: "open" | "merged" | "closed";
  merged_at_ms: string | null;
  published_at_ms: string;
  updated_at_ms: string;
  storage_backend: string;
};

export function serializeBookmark(row: BookmarkRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    repo_full_name: row.repo_full_name,
    branch_name: row.branch_name,
    title: row.title,
    revision: row.revision,
    latest_event_id: row.latest_event_id,
    head_commit_id: row.head_commit_id,
    github_pr_url: row.github_pr_url,
    github_pr_number: row.github_pr_number,
    remote_head_sha: row.remote_head_sha,
    merge_status: row.merge_status,
    merged_at_ms: row.merged_at_ms === null ? null : Number(row.merged_at_ms),
    published_at_ms: Number(row.published_at_ms),
    updated_at_ms: Number(row.updated_at_ms),
    storage_backend: row.storage_backend,
  };
}

export function serializeBookmarkForConsole(row: BookmarkRow) {
  return {
    id: row.id,
    repoFullName: row.repo_full_name,
    branchName: row.branch_name,
    title: row.title,
    revision: row.revision,
    latestEventId: row.latest_event_id,
    headCommitId: row.head_commit_id,
    githubPrUrl: row.github_pr_url,
    githubPrNumber: row.github_pr_number,
    remoteHeadSha: row.remote_head_sha,
    mergeStatus: row.merge_status,
    mergedAtMs: row.merged_at_ms === null ? undefined : Number(row.merged_at_ms),
    publishedAtMs: Number(row.published_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    storageBackend: row.storage_backend,
  };
}
