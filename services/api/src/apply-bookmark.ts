import type { AuthContext, BookmarkSyncPayload, PushBundle } from "./types";
import { syncPushToConvex } from "./sync-convex-push";
import { syncBookmarkToConvex } from "./sync-bookmark";
import { ingestDevBookmark } from "./convex-client";
import type { ApplyResult, JjOp } from "./jj-worker-client";
import { applyBookmarkOps, WorkerRequestError } from "./jj-worker-client";
import {
  ingestBookmarkEvent,
  resolveBranchName,
  resolveRepoFullName,
} from "./ingest-bookmark-event";
import type { getSql } from "./db";

type Sql = ReturnType<typeof getSql>;

async function syncIngestedBookmarkToConvex(
  bookmark: BookmarkSyncPayload,
  auth: AuthContext,
  cliToken?: string,
): Promise<void> {
  if (cliToken) {
    await syncPushToConvex(cliToken, bookmark, auth);
    return;
  }

  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error("Missing CLI token for Convex bookmark sync");
  }

  await ingestDevBookmark(
    webhookSecret,
    auth.userId,
    auth.sessionId === "console" ? undefined : auth.sessionId,
    bookmark,
  );
}

type BookmarkRow = {
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

export async function applyBookmarkOpsWithIngest(input: {
  db: Sql;
  auth: AuthContext;
  bookmarkId: string;
  ops: JjOp[];
  cliToken?: string;
}): Promise<{
  result: ApplyResult;
  eventId?: string;
  bookmarkRow: BookmarkRow;
}> {
  const existing = await input.db<BookmarkRow[]>`
    SELECT *
    FROM gx_bookmarks
    WHERE id = ${input.bookmarkId}
      AND user_id = ${input.auth.userId}
    LIMIT 1
  `;
  if (!existing[0]) {
    throw new WorkerRequestError(404, "Not found");
  }

  const result = await applyBookmarkOps({
    bookmarkId: input.bookmarkId,
    userId: input.auth.userId,
    ops: input.ops,
  });

  if (result.stackPayload) {
    const payload = result.stackPayload as PushBundle;
    const ingestResult = await input.db.begin(async (tx) =>
      ingestBookmarkEvent({
        tx,
        auth: input.auth,
        payload,
        repoFullName: resolveRepoFullName(input.auth, payload),
        branchName: resolveBranchName(payload),
        headCommitId: result.headCommitId,
        remoteHeadSha: result.remoteHeadSha,
        preserveTitle: existing[0]!.title,
      }),
    );

    await syncIngestedBookmarkToConvex(ingestResult.bookmark, input.auth, input.cliToken);

    const updatedRows = await input.db<BookmarkRow[]>`
      SELECT *
      FROM gx_bookmarks
      WHERE id = ${input.bookmarkId}
        AND user_id = ${input.auth.userId}
      LIMIT 1
    `;
    const bookmarkRow = updatedRows[0];
    if (!bookmarkRow) {
      throw new Error("Bookmark missing after ingest");
    }

    return {
      result,
      eventId: ingestResult.eventId,
      bookmarkRow,
    };
  }

  const updatedRows = await input.db<BookmarkRow[]>`
    SELECT *
    FROM gx_bookmarks
    WHERE id = ${input.bookmarkId}
      AND user_id = ${input.auth.userId}
    LIMIT 1
  `;
  const bookmarkRow = updatedRows[0];
  if (!bookmarkRow) {
    throw new Error("Bookmark missing after apply");
  }

  if (input.cliToken) {
    await syncBookmarkToConvex(bookmarkRow, input.auth, input.cliToken);
  }

  return { result, bookmarkRow };
}
