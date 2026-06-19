import { Hono } from "hono";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";

export type ActivityItem = {
  kind: "summary" | "session" | "rule";
  id: string;
  atMs: number;
  title: string;
  detail?: string;
};

export const activityRoutes = new Hono<AppEnv>();

activityRoutes.use("/v1/activity", requireAuth);

activityRoutes.get("/v1/activity", async (c) => {
  const auth = c.get("auth");
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const cursor = c.req.query("cursor")?.trim() ?? "";

  const db = getSql();
  const page = await loadActivityFeed(db, auth.orgId, limit, cursor);
  return c.json({ items: page.items, limit, nextCursor: page.nextCursor });
});

type ActivityPage = {
  items: ActivityItem[];
  nextCursor: string | null;
};

function encodeActivityCursor(item: ActivityItem): string {
  return `${item.atMs}:${item.kind}:${item.id}`;
}

function activityAfterCursor(item: ActivityItem, cursor: string): boolean {
  const parts = cursor.split(":");
  if (parts.length < 3) return true;
  const atMs = Number.parseInt(parts[0] ?? "", 10);
  if (!Number.isFinite(atMs)) return true;
  const kind = parts[1] ?? "";
  const id = parts.slice(2).join(":");
  if (item.atMs < atMs) return true;
  if (item.atMs > atMs) return false;
  if (item.kind !== kind) return item.kind < kind;
  return item.id < id;
}

async function loadActivityFeed(
  db: ReturnType<typeof getSql>,
  orgId: string,
  limit: number,
  cursor = "",
): Promise<ActivityPage> {
  const perSource = Math.max(limit + 1, 20);

  const summaries = await db<{
    id: string;
    posted_at_ms: number;
    bookmark_id: string;
    model: string | null;
  }[]>`
    SELECT id, posted_at_ms, bookmark_id, model
    FROM summaries
    WHERE org_id = ${orgId}
    ORDER BY posted_at_ms DESC
    LIMIT ${perSource}
  `;

  const sessions = await db<{
    id: string;
    captured_at_ms: number;
    session_id: string;
    tool: string;
    model: string | null;
  }[]>`
    SELECT id, captured_at_ms, session_id, tool, model
    FROM sessions_raw
    WHERE org_id = ${orgId}
    ORDER BY captured_at_ms DESC
    LIMIT ${perSource}
  `;

  const rules = await db<{
    id: string;
    created_at_ms: number;
    rule_text: string;
    strength: string;
    status: string;
  }[]>`
    SELECT id, created_at_ms, rule_text, strength, status
    FROM rules
    WHERE org_id = ${orgId}
    ORDER BY created_at_ms DESC
    LIMIT ${perSource}
  `;

  const merged: ActivityItem[] = [
    ...summaries.map((row) => ({
      kind: "summary" as const,
      id: row.id,
      atMs: Number(row.posted_at_ms),
      title: "PR Summary posted",
      detail: row.model ? `model: ${row.model}` : undefined,
    })),
    ...sessions.map((row) => ({
      kind: "session" as const,
      id: row.id,
      atMs: Number(row.captured_at_ms),
      title: "Session captured",
      detail: `${row.tool}${row.model ? ` / ${row.model}` : ""} · ${row.session_id}`,
    })),
    ...rules.map((row) => ({
      kind: "rule" as const,
      id: row.id,
      atMs: Number(row.created_at_ms),
      title: "Rule learned",
      detail: `${row.strength} · ${row.status}: ${row.rule_text.slice(0, 120)}`,
    })),
  ];

  merged.sort((a, b) => {
    if (b.atMs !== a.atMs) return b.atMs - a.atMs;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });

  const filtered = cursor
    ? merged.filter((item) => activityAfterCursor(item, cursor))
    : merged;
  const items = filtered.slice(0, limit);
  const nextCursor =
    filtered.length > limit && items.length > 0
      ? encodeActivityCursor(items[items.length - 1]!)
      : null;
  return { items, nextCursor };
}
