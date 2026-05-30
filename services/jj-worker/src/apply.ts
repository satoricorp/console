import type { WorkerConfig } from "./config";
import { loadBookmark, updateBookmarkAfterApply } from "./db";
import { getRemoteBranchSha } from "./github";
import { applyOps, formatJjError } from "./ops";
import type { ApplyRequest, ApplyResult } from "./types";
import { pushBookmark, withWorkspace } from "./workspace";

export class ApplyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApplyError";
    this.status = status;
  }
}

export async function applyBookmarkRevision(
  config: WorkerConfig,
  request: ApplyRequest,
): Promise<ApplyResult> {
  if (request.ops.length === 0) {
    throw new ApplyError(400, "At least one op is required");
  }

  const bookmark = await loadBookmark(
    config.databaseUrl,
    request.bookmarkId,
    request.userId,
  );
  if (!bookmark) {
    throw new ApplyError(404, "Bookmark not found");
  }
  if (bookmark.merge_status !== "open") {
    throw new ApplyError(
      409,
      `Bookmark is ${bookmark.merge_status}; only open bookmarks can be mutated`,
    );
  }
  if (!bookmark.remote_url) {
    throw new ApplyError(
      409,
      "Bookmark has no remote_url on its latest event; publish with gx pr first",
    );
  }
  if (!config.githubToken) {
    throw new ApplyError(
      503,
      "GITHUB_TOKEN is not configured on jj-worker",
    );
  }

  let headCommitId: string;
  try {
    headCommitId = await withWorkspace(
      config.workspaceRoot,
      request.userId,
      bookmark.repo_full_name,
      bookmark.remote_url,
      config.githubToken,
      bookmark.branch_name,
      async (cwd) => {
        await applyOps(cwd, bookmark.branch_name, request.ops);
        return pushBookmark(cwd, bookmark.branch_name);
      },
    );
  } catch (error) {
    throw new ApplyError(502, formatJjError(error));
  }

  let remoteHeadSha: string | null = null;
  try {
    remoteHeadSha = await getRemoteBranchSha(
      config.githubToken,
      bookmark.repo_full_name,
      bookmark.branch_name,
    );
  } catch (error) {
    console.warn("Failed to resolve remote branch SHA after push", error);
  }

  const updated = await updateBookmarkAfterApply(
    config.databaseUrl,
    request.bookmarkId,
    request.userId,
    headCommitId,
    remoteHeadSha,
  );

  return {
    bookmarkId: request.bookmarkId,
    revision: updated.revision,
    headCommitId: updated.headCommitId,
    remoteHeadSha: updated.remoteHeadSha,
  };
}
