import { Hono } from "hono";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";

export const bookmarksRoutes = new Hono<AppEnv>();

bookmarksRoutes.use("/bookmarks", requireAuth);

type BookmarkListRow = {
  id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  head_commit_id: string | null;
  remote_head_sha: string | null;
  merge_status: string;
  updated_at_ms: number | string;
};

bookmarksRoutes.get("/bookmarks", async (c) => {
  const auth = c.get("auth");
  const mergeStatus = c.req.query("merge_status")?.trim();
  const repoFullName = c.req.query("repo_full_name")?.trim();

  if (
    mergeStatus &&
    mergeStatus !== "open" &&
    mergeStatus !== "merged" &&
    mergeStatus !== "closed"
  ) {
    return c.json({ error: "Invalid merge_status" }, 400);
  }

  const db = getSql();
  const rows = await db<BookmarkListRow[]>`
    SELECT
      id,
      repo_full_name,
      branch_name,
      title,
      revision,
      head_commit_id,
      remote_head_sha,
      merge_status,
      updated_at_ms
    FROM bookmarks
    WHERE org_id = ${auth.orgId}
      ${mergeStatus ? db`AND merge_status = ${mergeStatus}` : db``}
      ${repoFullName ? db`AND repo_full_name = ${repoFullName}` : db``}
    ORDER BY updated_at_ms DESC
  `;

  return c.json(
    rows.map((row) => ({
      id: row.id,
      repo_full_name: row.repo_full_name,
      branch_name: row.branch_name,
      title: row.title,
      revision: Number(row.revision),
      head_commit_id: row.head_commit_id,
      remote_head_sha: row.remote_head_sha,
      merge_status: row.merge_status,
      updated_at_ms: Number(row.updated_at_ms),
    })),
  );
});
