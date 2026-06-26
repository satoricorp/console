import { Hono } from "hono";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";

export const reportedLogsRoutes = new Hono<AppEnv>();

reportedLogsRoutes.use("/v1/reported-logs", requireAuth);

reportedLogsRoutes.post("/v1/reported-logs", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => null);
  if (!isRecord(body)) {
    return c.json({ error: "valid JSON body is required" }, 400);
  }

  const logs = normalizeLogs(body.logs);
  const db = getSql();
  const [row] = await db<{ id: string }[]>`
    INSERT INTO reported_logs (
      org_id, user_id, gx_version, os, arch, repo_root, repo_full_name,
      cloud_url, error, status_error, log_count, logs, created_at_ms
    ) VALUES (
      ${auth.orgId},
      ${auth.userId},
      ${nullableString(body.gx_version)},
      ${nullableString(body.os)},
      ${nullableString(body.arch)},
      ${nullableString(body.repo_root)},
      ${nullableString(body.repo_full_name)},
      ${nullableString(body.cloud_url)},
      ${nullableString(body.error)},
      ${nullableString(body.status_error)},
      ${logs.length},
      ${db.json(logs)},
      ${Date.now()}
    )
    RETURNING id
  `;

  return c.json({ id: row.id });
});

function normalizeLogs(value: unknown): Array<{ path: string; content: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = stringValue(item.path).slice(0, 500);
    const content = stringValue(item.content).slice(0, 128 * 1024);
    if (!path && !content) return [];
    return [{ path, content }];
  }).slice(0, 10);
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
