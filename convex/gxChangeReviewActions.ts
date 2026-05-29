"use node";

import { v } from "convex/values";
import postgres from "postgres";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  DEFAULT_APPROVAL_THRESHOLD_PERCENT,
  extractStackChanges,
  reviewMapFromRecords,
  stackApprovalSummary,
} from "./lib/gxStack";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}

export const syncReviewToPostgres = internalAction({
  args: {
    userId: v.string(),
    bookmarkId: v.string(),
    jjChangeId: v.string(),
    stackIndex: v.number(),
    approvalPercent: v.number(),
    notes: v.union(v.null(), v.string()),
    updatedAtMs: v.number(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const sql = getSql();
    try {
      const bookmark = await sql<{ id: string }[]>`
        SELECT id
        FROM gx_bookmarks
        WHERE id = ${args.bookmarkId}
          AND user_id = ${args.userId}
        LIMIT 1
      `;
      if (!bookmark[0]) {
        throw new Error("Bookmark not found in Postgres");
      }

      await sql`
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
          ${args.userId},
          ${args.bookmarkId},
          ${args.jjChangeId},
          ${args.stackIndex},
          ${args.approvalPercent},
          ${args.notes},
          ${args.updatedAtMs},
          ${args.updatedAtMs}
        )
        ON CONFLICT (user_id, bookmark_id, jj_change_id)
        DO UPDATE SET
          stack_index = EXCLUDED.stack_index,
          approval_percent = EXCLUDED.approval_percent,
          notes = EXCLUDED.notes,
          updated_at_ms = EXCLUDED.updated_at_ms
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }
    return null;
  },
});

export const loadStackApprovalBlockReason = internalAction({
  args: {
    userId: v.string(),
    bookmarkId: v.string(),
    payload: v.any(),
    approvalThresholdPercent: v.optional(v.number()),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const threshold =
      args.approvalThresholdPercent ?? DEFAULT_APPROVAL_THRESHOLD_PERCENT;
    const changes = extractStackChanges(args.payload);
    if (changes.length === 0) {
      return null;
    }

    const reviews = await ctx.runQuery(
      internal.gxChangeReviews.listChangeReviewsForUser,
      {
        userId: args.userId,
        bookmarkId: args.bookmarkId,
      },
    );

    const summary = stackApprovalSummary(
      changes,
      reviewMapFromRecords(reviews),
      threshold,
    );
    return summary.blockedReason;
  },
});
