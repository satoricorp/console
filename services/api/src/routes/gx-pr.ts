import { Hono } from "hono";
import { getSql } from "../db";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import type { PushBundle } from "../types";
import {
  extractIndexFields,
  PayloadValidationError,
  validatePushBundle,
} from "../validate-payload";

export const gxPrRoutes = new Hono<AppEnv>();

gxPrRoutes.use("*", requireAuth);

function reviewUrl(eventId: string): string | undefined {
  const siteUrl = process.env.CONSOLE_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) {
    return undefined;
  }
  return `${siteUrl}/reviews/${eventId}`;
}

gxPrRoutes.post("/pr", async (c) => {
  let payload: PushBundle;
  try {
    const body = await c.req.json();
    payload = validatePushBundle(body);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const auth = c.get("auth");
  const indexFields = extractIndexFields(payload);
  const db = getSql();

  try {
    const [row] = await db<
      { id: string }[]
    >`
      INSERT INTO gx_pr_events (
        event,
        created_at_ms,
        gx_version,
        user_id,
        session_id,
        machine_id,
        github_user_id,
        github_user_login,
        repo_root_path,
        repo_backend,
        remote_url,
        branch_name,
        head_commit_id,
        github_pr_url,
        payload
      ) VALUES (
        ${payload.event},
        ${payload.created_at},
        ${payload.gx_version},
        ${auth.userId},
        ${auth.sessionId},
        ${auth.machineId},
        ${auth.githubUserId},
        ${auth.githubUserLogin},
        ${indexFields.repo_root_path},
        ${indexFields.repo_backend},
        ${indexFields.remote_url},
        ${indexFields.branch_name},
        ${indexFields.head_commit_id},
        ${indexFields.github_pr_url},
        ${db.json(payload)}
      )
      RETURNING id
    `;

    const url = reviewUrl(row.id);
    return c.json({ id: row.id, ...(url ? { url } : {}) }, 201);
  } catch (error) {
    console.error("Failed to ingest gx.pr event", error);
    return c.json({ error: "Failed to store event" }, 500);
  }
});
