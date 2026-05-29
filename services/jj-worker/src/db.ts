import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

export function getSql(databaseUrl: string) {
  if (!sql) {
    sql = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}

export type BookmarkRecord = {
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
  remote_url: string | null;
  latest_payload: Record<string, unknown> | null;
};

export async function loadBookmark(
  databaseUrl: string,
  bookmarkId: string,
  userId: string,
): Promise<BookmarkRecord | null> {
  const db = getSql(databaseUrl);
  const rows = await db<
    BookmarkRecord[]
  >`
    SELECT
      b.*,
      e.remote_url,
      e.payload AS latest_payload
    FROM gx_bookmarks b
    LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
    WHERE b.id = ${bookmarkId}
      AND b.user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function updateBookmarkAfterApply(
  databaseUrl: string,
  bookmarkId: string,
  userId: string,
  headCommitId: string,
  remoteHeadSha: string | null,
): Promise<{
  revision: number;
  headCommitId: string;
  remoteHeadSha: string | null;
  updatedAtMs: number;
}> {
  const db = getSql(databaseUrl);
  const now = Date.now();
  const rows = await db<
    {
      revision: number;
      head_commit_id: string;
      remote_head_sha: string | null;
      updated_at_ms: string;
    }[]
  >`
    UPDATE gx_bookmarks
    SET
      revision = gx_bookmarks.revision + 1,
      head_commit_id = ${headCommitId},
      remote_head_sha = ${remoteHeadSha},
      updated_at_ms = ${now}
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
    RETURNING revision, head_commit_id, remote_head_sha, updated_at_ms
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Bookmark not found during update");
  }

  return {
    revision: row.revision,
    headCommitId: row.head_commit_id,
    remoteHeadSha: row.remote_head_sha,
    updatedAtMs: Number(row.updated_at_ms),
  };
}
