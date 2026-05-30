import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authComponent } from "./auth";

const changeReviewShape = v.object({
  jjChangeId: v.string(),
  stackIndex: v.number(),
  approvalPercent: v.number(),
  notes: v.optional(v.string()),
  updatedAtMs: v.number(),
});

async function upsertConvexReview(
  ctx: MutationCtx,
  userId: string,
  bookmarkId: string,
  review: {
    jjChangeId: string;
    stackIndex: number;
    approvalPercent: number;
    notes?: string;
    updatedAtMs: number;
  },
) {
  const existing = await ctx.db
    .query("gxChangeReviews")
    .withIndex("by_userId_bookmarkId_jjChangeId", (q) =>
      q
        .eq("userId", userId)
        .eq("bookmarkId", bookmarkId)
        .eq("jjChangeId", review.jjChangeId),
    )
    .first();

  const fields = {
    userId,
    bookmarkId,
    jjChangeId: review.jjChangeId,
    stackIndex: review.stackIndex,
    approvalPercent: review.approvalPercent,
    notes: review.notes,
    updatedAtMs: review.updatedAtMs,
  };

  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }

  await ctx.db.insert("gxChangeReviews", fields);
}

export const listChangeReviewsForUser = internalQuery({
  args: {
    userId: v.string(),
    bookmarkId: v.string(),
  },
  returns: v.array(
    v.object({
      jjChangeId: v.string(),
      stackIndex: v.number(),
      approvalPercent: v.number(),
      notes: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const reviews = await ctx.db
      .query("gxChangeReviews")
      .withIndex("by_userId_bookmarkId", (q) =>
        q.eq("userId", args.userId).eq("bookmarkId", args.bookmarkId),
      )
      .collect();

    return reviews
      .sort((a, b) => a.stackIndex - b.stackIndex)
      .map((review) => ({
        jjChangeId: review.jjChangeId,
        stackIndex: review.stackIndex,
        approvalPercent: review.approvalPercent,
        notes: review.notes,
      }));
  },
});

export const listChangeReviews = query({
  args: {
    bookmarkId: v.string(),
  },
  returns: v.array(changeReviewShape),
  handler: async (ctx, { bookmarkId }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const reviews = await ctx.db
      .query("gxChangeReviews")
      .withIndex("by_userId_bookmarkId", (q) =>
        q.eq("userId", user._id).eq("bookmarkId", bookmarkId),
      )
      .collect();

    return reviews
      .sort((a, b) => a.stackIndex - b.stackIndex)
      .map((review) => ({
        jjChangeId: review.jjChangeId,
        stackIndex: review.stackIndex,
        approvalPercent: review.approvalPercent,
        notes: review.notes,
        updatedAtMs: review.updatedAtMs,
      }));
  },
});

export const upsertChangeReview = mutation({
  args: {
    bookmarkId: v.string(),
    jjChangeId: v.string(),
    stackIndex: v.number(),
    approvalPercent: v.number(),
    notes: v.optional(v.string()),
  },
  returns: changeReviewShape,
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const approvalPercent = Math.round(args.approvalPercent);
    if (
      !Number.isInteger(approvalPercent) ||
      approvalPercent < 0 ||
      approvalPercent > 100
    ) {
      throw new Error("approvalPercent must be an integer from 0 to 100");
    }

    if (!Number.isInteger(args.stackIndex) || args.stackIndex < 0) {
      throw new Error("stackIndex must be a non-negative integer");
    }

    const notes = args.notes?.trim() ? args.notes.trim() : undefined;
    if (notes && notes.length > 10000) {
      throw new Error("notes is too long");
    }

    const updatedAtMs = Date.now();
    const saved = {
      jjChangeId: args.jjChangeId,
      stackIndex: args.stackIndex,
      approvalPercent,
      notes,
      updatedAtMs,
    };

    await upsertConvexReview(ctx, user._id, args.bookmarkId, saved);

    await ctx.scheduler.runAfter(
      0,
      internal.gxChangeReviewActions.syncReviewToPostgres,
      {
        userId: user._id,
        bookmarkId: args.bookmarkId,
        jjChangeId: args.jjChangeId,
        stackIndex: args.stackIndex,
        approvalPercent,
        notes: notes ?? null,
        updatedAtMs,
      },
    );

    return saved;
  },
});
