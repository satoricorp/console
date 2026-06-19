import { Hono, type Context } from "hono";
import { getSql } from "../db";
import { loadFullPayload } from "../gx-payload-store";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import type { PushBundle } from "../types";
import {
  type BookmarkRow,
  serializeBookmark,
  serializeBookmarkForConsole,
} from "../bookmark-types";

export const bookmarksRoutes = new Hono<AppEnv>();

bookmarksRoutes.use("*", requireAuth);

function consoleFormat(c: { req: { query: (key: string) => string | undefined } }) {
  return c.req.query("format") === "console";
}

function respondBookmark(
  c: Context<AppEnv>,
  row: BookmarkRow,
  extra?: Record<string, unknown>,
) {
  const payload = consoleFormat(c)
    ? serializeBookmarkForConsole(row)
    : serializeBookmark(row);
  return c.json({ ...payload, ...extra });
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

  const serialized = consoleFormat(c)
    ? rows.map(serializeBookmarkForConsole)
    : rows.map(serializeBookmark);
  return c.json(serialized);
});

bookmarksRoutes.get("/by-event/:eventId", async (c) => {
  const auth = c.get("auth");
  const eventId = c.req.param("eventId");
  const db = getSql();

  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM gx_bookmarks
    WHERE latest_event_id = ${eventId}
      AND user_id = ${auth.userId}
    LIMIT 1
  `;

  return c.json({ bookmarkId: rows[0]?.id ?? null });
});

bookmarksRoutes.get("/:id/change-reviews", async (c) => {
  const auth = c.get("auth");
  const bookmarkId = c.req.param("id");
  const db = getSql();

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
    WHERE user_id = ${auth.userId}
      AND bookmark_id = ${bookmarkId}
    ORDER BY stack_index ASC
  `;

  return c.json(
    rows.map((row) => ({
      jjChangeId: row.jj_change_id,
      stackIndex: row.stack_index,
      approvalPercent: row.approval_percent,
      notes: row.notes ?? undefined,
      updatedAtMs: Number(row.updated_at_ms),
    })),
  );
});

bookmarksRoutes.post("/:id/change-reviews", async (c) => {
  const auth = c.get("auth");
  const bookmarkId = c.req.param("id");
  const db = getSql();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const jjChangeId =
    typeof body === "object" &&
    body !== null &&
    "jjChangeId" in body &&
    typeof body.jjChangeId === "string"
      ? body.jjChangeId
      : null;
  const stackIndex =
    typeof body === "object" &&
    body !== null &&
    "stackIndex" in body &&
    typeof body.stackIndex === "number"
      ? body.stackIndex
      : null;
  const approvalPercentRaw =
    typeof body === "object" &&
    body !== null &&
    "approvalPercent" in body &&
    typeof body.approvalPercent === "number"
      ? Math.round(body.approvalPercent)
      : null;
  const notes =
    typeof body === "object" &&
    body !== null &&
    "notes" in body &&
    typeof body.notes === "string" &&
    body.notes.trim()
      ? body.notes.trim()
      : undefined;

  if (!jjChangeId) {
    return c.json({ error: "jjChangeId is required" }, 400);
  }
  if (stackIndex === null || !Number.isInteger(stackIndex) || stackIndex < 0) {
    return c.json({ error: "stackIndex must be a non-negative integer" }, 400);
  }
  if (
    approvalPercentRaw === null ||
    !Number.isInteger(approvalPercentRaw) ||
    approvalPercentRaw < 0 ||
    approvalPercentRaw > 100
  ) {
    return c.json(
      { error: "approvalPercent must be an integer from 0 to 100" },
      400,
    );
  }
  if (notes && notes.length > 10000) {
    return c.json({ error: "notes is too long" }, 400);
  }

  const bookmark = await db<BookmarkRow[]>`
    SELECT *
    FROM gx_bookmarks
    WHERE id = ${bookmarkId}
      AND user_id = ${auth.userId}
    LIMIT 1
  `;
  if (!bookmark[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const updatedAtMs = Date.now();
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
      ${auth.userId},
      ${bookmarkId},
      ${jjChangeId},
      ${stackIndex},
      ${approvalPercentRaw},
      ${notes ?? null},
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

  return c.json({
    jjChangeId,
    stackIndex,
    approvalPercent: approvalPercentRaw,
    notes,
    updatedAtMs,
  });
});

bookmarksRoutes.post("/:id/mark-merged", async (c) => {
  const auth = c.get("auth");
  const bookmarkId = c.req.param("id");
  const db = getSql();

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const remoteHeadSha =
    typeof body === "object" &&
    body !== null &&
    "remoteHeadSha" in body &&
    typeof body.remoteHeadSha === "string"
      ? body.remoteHeadSha
      : undefined;

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
      AND user_id = ${auth.userId}
      AND merge_status = 'open'
  `;

  return c.json({ ok: true });
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
    const payload = row.event_payload
      ? await loadFullPayload(db, row.latest_event_id, row.event_payload as PushBundle)
      : undefined;
    return respondBookmark(c, row, {
      payload,
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

  return respondBookmark(c, row);
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

  return respondBookmark(c, row);
});

bookmarksRoutes.post("/:id/close", async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth");
  const db = getSql();
  const now = Date.now();

  const rows = await db<BookmarkRow[]>`
    UPDATE gx_bookmarks
    SET
      merge_status = 'closed',
      revision = revision + 1,
      updated_at_ms = ${now}
    WHERE id = ${id}
      AND user_id = ${auth.userId}
      AND merge_status = 'open'
    RETURNING *
  `;

  const row = rows[0];
  if (!row) {
    const existing = await db<BookmarkRow[]>`
      SELECT *
      FROM gx_bookmarks
      WHERE id = ${id}
        AND user_id = ${auth.userId}
      LIMIT 1
    `;
    if (!existing[0]) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(
      {
        error: `Bookmark is ${existing[0].merge_status}; only open bookmarks can be archived`,
      },
      409,
    );
  }

  return respondBookmark(c, row);
});

bookmarksRoutes.post("/:id/apply", async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth");
  const db = getSql();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const ops =
    typeof body === "object" &&
    body !== null &&
    "ops" in body &&
    Array.isArray(body.ops)
      ? body.ops
      : null;

  if (!ops || ops.length === 0) {
    return c.json({ error: "ops[] is required" }, 400);
  }

  const existing = await db<BookmarkRow[]>`
    SELECT *
    FROM gx_bookmarks
    WHERE id = ${id}
      AND user_id = ${auth.userId}
    LIMIT 1
  `;
  if (!existing[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const { applyBookmarkOps, WorkerRequestError } = await import(
    "../jj-worker-client"
  );

  try {
    const result = await applyBookmarkOps({
      bookmarkId: id,
      userId: auth.userId,
      ops: ops as import("../jj-worker-client").JjOp[],
    });

    const updatedRows = await db<BookmarkRow[]>`
      SELECT *
      FROM gx_bookmarks
      WHERE id = ${id}
        AND user_id = ${auth.userId}
      LIMIT 1
    `;
    const updated = updatedRows[0];
    if (!updated) {
      return c.json({ error: "Bookmark missing after apply" }, 500);
    }

    return c.json({
      ...result,
      bookmark: consoleFormat(c)
        ? serializeBookmarkForConsole(updated)
        : serializeBookmark(updated),
    });
  } catch (error) {
    if (error instanceof WorkerRequestError) {
      const status =
        error.status >= 400 && error.status < 600
          ? (error.status as 400 | 404 | 409 | 502 | 503)
          : 502;
      return c.json({ error: error.message }, status);
    }
    if (error instanceof Error && error.message.includes("JJ_WORKER_URL")) {
      return c.json({ error: error.message }, 503);
    }
    console.error("Failed to apply bookmark ops", error);
    return c.json({ error: "Failed to apply bookmark ops" }, 500);
  }
});
