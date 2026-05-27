import { Hono } from "hono";
import { getSql } from "../db";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

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

export const bookmarksRoutes = new Hono<AppEnv>();

bookmarksRoutes.use("*", requireAuth);

function serializeBookmark(row: BookmarkRow) {
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

bookmarksRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const mergeStatus = c.req.query("merge_status");
  const repoFullName = c.req.query("repo_full_name");
  const db = getSql();

  if (
    mergeStatus &&
    mergeStatus !== "open" &&
    mergeStatus !== "merged" &&
    mergeStatus !== "closed"
  ) {
    return c.json({ error: "Invalid merge_status" }, 400);
  }

  const rows = await db<BookmarkRow[]>`
    SELECT *
    FROM gx_bookmarks
    WHERE user_id = ${auth.userId}
      ${mergeStatus ? db`AND merge_status = ${mergeStatus}` : db``}
      ${repoFullName ? db`AND repo_full_name = ${repoFullName}` : db``}
    ORDER BY updated_at_ms DESC
  `;

  return c.json(rows.map(serializeBookmark));
});

bookmarksRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth");
  const includePayload = c.req.query("include_payload") === "1";
  const db = getSql();

  if (includePayload) {
    const rows = await db<
      (BookmarkRow & {
        event_payload: unknown;
      })[]
    >`
      SELECT b.*, e.payload AS event_payload
      FROM gx_bookmarks b
      LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
      WHERE b.id = ${id}
        AND b.user_id = ${auth.userId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json({
      ...serializeBookmark(row),
      payload: row.event_payload ?? null,
    });
  }

  const rows = await db<BookmarkRow[]>`
    SELECT *
    FROM gx_bookmarks
    WHERE id = ${id}
      AND user_id = ${auth.userId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(serializeBookmark(row));
});

bookmarksRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth");
  const db = getSql();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const title =
    typeof body === "object" &&
    body !== null &&
    "title" in body &&
    typeof body.title === "string"
      ? body.title.trim()
      : null;

  if (!title) {
    return c.json({ error: "Title is required" }, 400);
  }
  if (title.length > 280) {
    return c.json({ error: "Title is too long" }, 400);
  }

  const now = Date.now();
  const rows = await db<BookmarkRow[]>`
    UPDATE gx_bookmarks
    SET
      title = ${title},
      updated_at_ms = ${now}
    WHERE id = ${id}
      AND user_id = ${auth.userId}
    RETURNING *
  `;

  const row = rows[0];
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(serializeBookmark(row));
});
