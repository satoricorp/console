import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

export function getLocalSql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!sql) {
    sql = postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
  }
  return sql;
}

export type LocalBookmarkRow = {
  id: string;
  repoFullName: string;
  branchName: string;
  title: string | null;
  revision: number;
  latestEventId: string;
  headCommitId: string | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  remoteHeadSha: string | null;
  mergeStatus: "open" | "merged" | "closed";
  updatedAtMs: number;
};

export async function listBookmarksForUser(
  userId: string,
  mergeStatus?: "open" | "merged" | "closed",
): Promise<LocalBookmarkRow[]> {
  const db = getLocalSql();
  const rows = await db<
    {
      id: string;
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
      updated_at_ms: string;
    }[]
  >`
    SELECT
      id,
      repo_full_name,
      branch_name,
      title,
      revision,
      latest_event_id,
      head_commit_id,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      merge_status,
      updated_at_ms
    FROM gx_bookmarks
    WHERE user_id = ${userId}
      ${mergeStatus ? db`AND merge_status = ${mergeStatus}` : db``}
    ORDER BY updated_at_ms DESC
  `;

  return rows.map((row) => ({
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
    updatedAtMs: Number(row.updated_at_ms),
  }));
}

export async function getBookmarkMetaForUser(
  userId: string,
  bookmarkId: string,
): Promise<LocalBookmarkRow | null> {
  const db = getLocalSql();
  const rows = await db<
    {
      id: string;
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
      updated_at_ms: string;
    }[]
  >`
    SELECT
      id,
      repo_full_name,
      branch_name,
      title,
      revision,
      latest_event_id,
      head_commit_id,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      merge_status,
      updated_at_ms
    FROM gx_bookmarks
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

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
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export async function loadBookmarkPayload(bookmarkId: string): Promise<unknown | null> {
  const db = getLocalSql();
  const rows = await db<{ payload: unknown | null }[]>`
    SELECT e.payload
    FROM gx_bookmarks b
    LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
    WHERE b.id = ${bookmarkId}
    LIMIT 1
  `;
  return rows[0]?.payload ?? null;
}

export async function resolveBookmarkIdForEvent(
  userId: string,
  eventId: string,
): Promise<string | null> {
  const db = getLocalSql();
  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM gx_bookmarks
    WHERE latest_event_id = ${eventId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function listChangeReviewsForUser(
  userId: string,
  bookmarkId: string,
): Promise<
  Array<{
    jjChangeId: string;
    stackIndex: number;
    approvalPercent: number;
    notes?: string;
    updatedAtMs: number;
  }>
> {
  const db = getLocalSql();
  const rows = await db<
    {
      jj_change_id: string;
      stack_index: number;
      approval_percent: number;
      notes: string | null;
      updated_at_ms: string;
    }[]
  >`
    SELECT
      jj_change_id,
      stack_index,
      approval_percent,
      notes,
      updated_at_ms
    FROM gx_change_reviews
    WHERE user_id = ${userId}
      AND bookmark_id = ${bookmarkId}
    ORDER BY stack_index ASC
  `;

  return rows.map((row) => ({
    jjChangeId: row.jj_change_id,
    stackIndex: row.stack_index,
    approvalPercent: row.approval_percent,
    notes: row.notes ?? undefined,
    updatedAtMs: Number(row.updated_at_ms),
  }));
}

export async function upsertChangeReviewForUser(
  userId: string,
  bookmarkId: string,
  review: {
    jjChangeId: string;
    stackIndex: number;
    approvalPercent: number;
    notes?: string;
  },
): Promise<{
  jjChangeId: string;
  stackIndex: number;
  approvalPercent: number;
  notes?: string;
  updatedAtMs: number;
}> {
  const db = getLocalSql();
  const updatedAtMs = Date.now();
  const notes = review.notes?.trim() ? review.notes.trim() : null;

  await db`
    INSERT INTO gx_change_reviews (
      user_id,
      bookmark_id,
      jj_change_id,
      stack_index,
      approval_percent,
      notes,
      created_at_ms,
      updated_at_ms
    ) VALUES (
      ${userId},
      ${bookmarkId},
      ${review.jjChangeId},
      ${review.stackIndex},
      ${review.approvalPercent},
      ${notes},
      ${updatedAtMs},
      ${updatedAtMs}
    )
    ON CONFLICT (user_id, bookmark_id, jj_change_id)
    DO UPDATE SET
      stack_index = EXCLUDED.stack_index,
      approval_percent = EXCLUDED.approval_percent,
      notes = EXCLUDED.notes,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;

  return {
    jjChangeId: review.jjChangeId,
    stackIndex: review.stackIndex,
    approvalPercent: review.approvalPercent,
    notes: notes ?? undefined,
    updatedAtMs,
  };
}

export async function updateBookmarkTitleForUser(
  userId: string,
  bookmarkId: string,
  title: string,
): Promise<{ id: string; title: string; updatedAtMs: number }> {
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new Error("Title is required");
  }
  if (nextTitle.length > 280) {
    throw new Error("Title is too long");
  }

  const db = getLocalSql();
  const now = Date.now();
  const rows = await db<
    {
      id: string;
      title: string;
      updated_at_ms: string;
    }[]
  >`
    UPDATE gx_bookmarks
    SET
      title = ${nextTitle},
      updated_at_ms = ${now}
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
    RETURNING id, title, updated_at_ms
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Bookmark not found");
  }

  return {
    id: row.id,
    title: row.title,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export async function loadBookmarkChatContext(
  userId: string,
  bookmarkId: string,
): Promise<{
  repoFullName: string;
  branchName: string;
  title?: string;
  payload: unknown;
} | null> {
  const db = getLocalSql();
  const rows = await db<
    {
      repo_full_name: string;
      branch_name: string;
      title: string | null;
      payload: unknown | null;
    }[]
  >`
    SELECT
      b.repo_full_name,
      b.branch_name,
      b.title,
      e.payload
    FROM gx_bookmarks b
    LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
    WHERE b.id = ${bookmarkId}
      AND b.user_id = ${userId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row?.payload) {
    return null;
  }

  return {
    repoFullName: row.repo_full_name,
    branchName: row.branch_name,
    title: row.title ?? undefined,
    payload: row.payload,
  };
}

export async function markBookmarkMergedForUser(
  userId: string,
  bookmarkId: string,
  remoteHeadSha?: string,
): Promise<void> {
  const db = getLocalSql();
  const now = Date.now();
  await db`
    UPDATE gx_bookmarks
    SET
      merge_status = 'merged',
      merged_at_ms = ${now},
      revision = revision + 1,
      remote_head_sha = COALESCE(${remoteHeadSha ?? null}, remote_head_sha),
      updated_at_ms = ${now}
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
      AND merge_status = 'open'
  `;
}

export async function closeBookmarkForUser(
  userId: string,
  bookmarkId: string,
): Promise<LocalBookmarkRow> {
  const db = getLocalSql();
  const now = Date.now();
  const rows = await db<
    {
      id: string;
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
      updated_at_ms: string;
    }[]
  >`
    UPDATE gx_bookmarks
    SET
      merge_status = 'closed',
      revision = revision + 1,
      updated_at_ms = ${now}
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
      AND merge_status = 'open'
    RETURNING
      id,
      repo_full_name,
      branch_name,
      title,
      revision,
      latest_event_id,
      head_commit_id,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      merge_status,
      updated_at_ms
  `;

  const row = rows[0];
  if (!row) {
    const existing = await getBookmarkMetaForUser(userId, bookmarkId);
    if (!existing) {
      throw new Error("Bookmark not found");
    }
    throw new Error(
      `Bookmark is ${existing.mergeStatus}; only open bookmarks can be archived`,
    );
  }

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
    updatedAtMs: Number(row.updated_at_ms),
  };
}
