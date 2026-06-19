import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { repoFullNameFromPayload } from "./lib/gxPrPayload";

export const ingest = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.optional(v.string()),
    artifact: v.any(),
  },
  handler: async (ctx, { userId, sessionId, artifact }) => {
    return await ctx.db.insert("gxReviewArtifacts", {
      userId,
      sessionId,
      repoFullName: repoFullNameFromPayload(artifact),
      artifact,
      createdAt: Date.now(),
    });
  },
});

export const findUserIdForRepo = internalQuery({
  args: {
    repoFullName: v.string(),
  },
  handler: async (ctx, { repoFullName }): Promise<string | null> => {
    const repo = await ctx.db
      .query("connectedRepos")
      .withIndex("by_fullName", (q) => q.eq("fullName", repoFullName))
      .first();
    return repo?.userId ?? null;
  },
});

export const addComment = internalMutation({
  args: {
    userId: v.string(),
    reviewId: v.optional(v.string()),
    bookmarkId: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    scope: v.union(
      v.literal("pr"),
      v.literal("revision"),
      v.literal("file"),
      v.literal("line"),
    ),
    bodyMarkdown: v.string(),
    approvalPercent: v.optional(v.number()),
    authorLogin: v.string(),
    assigneeLogin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("gxReviewComments", {
      userId: args.userId,
      reviewId: args.reviewId,
      bookmarkId: args.bookmarkId,
      repoFullName: args.repoFullName,
      scope: args.scope,
      bodyMarkdown: args.bodyMarkdown,
      approvalPercent: args.approvalPercent,
      authorLogin: args.authorLogin,
      assigneeLogin: args.assigneeLogin,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
  },
});
