import { Hono } from "hono";
import { getSql } from "../db";
import { loadFullPayload } from "../gx-payload-store";
import type { AppEnv } from "../middleware/auth";
import { canAccessEvent, requireAuth } from "../middleware/auth";
import type { GxPrEventRow, PushBundle } from "../types";

export const eventsRoutes = new Hono<AppEnv>();

eventsRoutes.use("*", requireAuth);

function serializeEvent(row: GxPrEventRow) {
  return {
    id: row.id,
    event: row.event,
    created_at_ms: Number(row.created_at_ms),
    ingested_at: row.ingested_at.toISOString(),
    gx_version: row.gx_version,
    github_user_id:
      row.github_user_id === null ? null : Number(row.github_user_id),
    github_user_login: row.github_user_login,
    user_id: row.user_id,
    session_id: row.session_id,
    machine_id: row.machine_id,
    repo_root_path: row.repo_root_path,
    repo_backend: row.repo_backend,
    remote_url: row.remote_url,
    branch_name: row.branch_name,
    head_commit_id: row.head_commit_id,
    github_pr_url: row.github_pr_url,
    payload: row.payload,
  };
}

eventsRoutes.get("/latest", async (c) => {
  const remoteUrl = c.req.query("remote_url");
  const branchName = c.req.query("branch_name");
  const githubPrUrl = c.req.query("github_pr_url");

  if (!githubPrUrl && !(remoteUrl && branchName)) {
    return c.json(
      {
        error:
          "Provide github_pr_url or both remote_url and branch_name query params",
      },
      400,
    );
  }

  const auth = c.get("auth");
  const db = getSql();

  let row: GxPrEventRow | undefined;

  if (githubPrUrl) {
    [row] = await db<GxPrEventRow[]>`
      SELECT *
      FROM gx_pr_events
      WHERE github_pr_url = ${githubPrUrl}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
  } else {
    [row] = await db<GxPrEventRow[]>`
      SELECT *
      FROM gx_pr_events
      WHERE remote_url = ${remoteUrl!}
        AND branch_name = ${branchName!}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
  }
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  if (!canAccessEvent(auth, { userId: row.user_id, githubUserId: row.github_user_id === null ? null : Number(row.github_user_id) })) {
    return c.json({ error: "Not found" }, 404);
  }

  const payload = await loadFullPayload(db, row.id, row.payload as PushBundle);
  return c.json(serializeEvent({ ...row, payload }));
});

eventsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth");
  const db = getSql();

  const rows = await db<GxPrEventRow[]>`
    SELECT *
    FROM gx_pr_events
    WHERE id = ${id}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  if (!canAccessEvent(auth, { userId: row.user_id, githubUserId: row.github_user_id === null ? null : Number(row.github_user_id) })) {
    return c.json({ error: "Not found" }, 404);
  }

  const payload = await loadFullPayload(db, row.id, row.payload as PushBundle);
  return c.json(serializeEvent({ ...row, payload }));
});
