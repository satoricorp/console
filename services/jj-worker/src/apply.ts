import type { WorkerConfig } from "./config";
import { loadBookmark, updateBookmarkAfterApply } from "./db";
import { applyOps, formatJjError } from "./ops";
import { resolveBookmarkHead } from "./jj";
import type { ApplyRequest, ApplyResult, JjOp } from "./types";
import { exportStackFromWorkspace } from "./stack-export";
import type { ExportedPushBundle } from "./stack-types";
import { withWorkspace } from "./workspace";

export class ApplyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApplyError";
    this.status = status;
  }
}

function hasSplitOp(ops: JjOp[]): boolean {
  return ops.some((op) => op.type === "split_to_change");
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
  const shouldExportStack = hasSplitOp(request.ops);
  if (shouldExportStack && !bookmark.latest_payload) {
    throw new ApplyError(
      409,
      "Bookmark has no payload to refresh after split; publish with gx pr first",
    );
  }

  let headCommitId: string;
  let newJjChangeId: string | null = null;
  let stackPayload: Record<string, unknown> | null = null;

  try {
    headCommitId = await withWorkspace(
      config.workspaceRoot,
      request.userId,
      bookmark.repo_full_name,
      bookmark.remote_url,
      config.githubToken,
      bookmark.branch_name,
      async (cwd) => {
        newJjChangeId = await applyOps(cwd, bookmark.branch_name, request.ops);
        const localHead = await resolveBookmarkHead(cwd, bookmark.branch_name);

        if (shouldExportStack && bookmark.latest_payload) {
          const exported = await exportStackFromWorkspace(
            cwd,
            bookmark.branch_name,
            bookmark.latest_payload as ExportedPushBundle,
            localHead,
          );
          stackPayload = exported.payload as Record<string, unknown>;
          newJjChangeId = newJjChangeId ?? exported.newJjChangeId;
        }

        return localHead;
      },
    );
  } catch (error) {
    throw new ApplyError(502, formatJjError(error));
  }

  const updated = await updateBookmarkAfterApply(
    config.databaseUrl,
    request.bookmarkId,
    request.userId,
    headCommitId,
    bookmark.remote_head_sha,
  );

  return {
    bookmarkId: request.bookmarkId,
    revision: updated.revision,
    headCommitId: updated.headCommitId,
    remoteHeadSha: updated.remoteHeadSha,
    newJjChangeId,
    stackPayload,
  };
}
