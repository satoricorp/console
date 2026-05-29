import { Hono } from "hono";
import { getSql } from "../db";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

type ChangeReviewRow = {
  id: string;
  user_id: string;
  bookmark_id: string;
  jj_change_id: string;
  stack_index: number;
  approval_percent: number;
  notes: string | null;
  created_at_ms: string;
  updated_at_ms: string;
};

export const changeReviewsRoutes = new Hono<AppEnv>();

changeReviewsRoutes.use("*", requireAuth);

function serializeReview(row: ChangeReviewRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    bookmark_id: row.bookmark_id,
    jj_change_id: row.jj_change_id,
    stack_index: row.stack_index,
    approval_percent: row.approval_percent,
    notes: row.notes,
    created_at_ms: Number(row.created_at_ms),
    updated_at_ms: Number(row.updated_at_ms),
  };
}

changeReviewsRoutes.get("/bookmarks/:bookmarkId/change-reviews", async (c) => {
  const bookmarkId = c.req.param("bookmarkId");
  const auth = c.get("auth");
  const db = getSql();

  const bookmark = await db<{ id: string }[]>`
    SELECT id
    FROM gx_bookmarks
    WHERE id = ${bookmarkId}
      AND user_id = ${auth.userId}
    LIMIT 1
  `;
  if (!bookmark[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const rows = await db<ChangeReviewRow[]>`
    SELECT *
    FROM gx_change_reviews
    WHERE bookmark_id = ${bookmarkId}
      AND user_id = ${auth.userId}
    ORDER BY stack_index ASC
  `;

  return c.json(rows.map(serializeReview));
});

changeReviewsRoutes.put(
  "/bookmarks/:bookmarkId/changes/:jjChangeId/review",
  async (c) => {
    const bookmarkId = c.req.param("bookmarkId");
    const jjChangeId = c.req.param("jjChangeId");
    const auth = c.get("auth");
    const db = getSql();

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : null;

    const approvalPercent = record?.approval_percent;
    if (
      typeof approvalPercent !== "number" ||
      !Number.isInteger(approvalPercent) ||
      approvalPercent < 0 ||
      approvalPercent > 100
    ) {
      return c.json(
        { error: "approval_percent must be an integer from 0 to 100" },
        400,
      );
    }

    const stackIndex = record?.stack_index;
    if (
      typeof stackIndex !== "number" ||
      !Number.isInteger(stackIndex) ||
      stackIndex < 0
    ) {
      return c.json({ error: "stack_index must be a non-negative integer" }, 400);
    }

    const notes =
      record?.notes === undefined || record?.notes === null
        ? null
        : typeof record.notes === "string"
          ? record.notes
          : null;

    if (record?.notes !== undefined && record?.notes !== null && notes === null) {
      return c.json({ error: "notes must be a string or null" }, 400);
    }

    if (notes !== null && notes.length > 10000) {
      return c.json({ error: "notes is too long" }, 400);
    }

    const bookmark = await db<{ id: string }[]>`
      SELECT id
      FROM gx_bookmarks
      WHERE id = ${bookmarkId}
        AND user_id = ${auth.userId}
      LIMIT 1
    `;
    if (!bookmark[0]) {
      return c.json({ error: "Not found" }, 404);
    }

    const now = Date.now();
    const rows = await db<ChangeReviewRow[]>`
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
        ${approvalPercent},
        ${notes},
        ${now},
        ${now}
      )
      ON CONFLICT (user_id, bookmark_id, jj_change_id)
      DO UPDATE SET
        stack_index = EXCLUDED.stack_index,
        approval_percent = EXCLUDED.approval_percent,
        notes = EXCLUDED.notes,
        updated_at_ms = EXCLUDED.updated_at_ms
      RETURNING *
    `;

    return c.json(serializeReview(rows[0]!));
  },
);
