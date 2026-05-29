import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import { hashToken } from "./gxAuthUtils";
import { repoFullNameFromPayload } from "./lib/gxPrPayload";

const mergeStatusValidator = v.union(
  v.literal("open"),
  v.literal("merged"),
  v.literal("closed"),
);

const bookmarkInputValidator = {
  postgresBookmarkId: v.string(),
  latestEventId: v.string(),
  repoFullName: v.string(),
  branchName: v.string(),
  title: v.optional(v.string()),
  revision: v.number(),
  mergeStatus: mergeStatusValidator,
  githubPrUrl: v.optional(v.string()),
  githubPrNumber: v.optional(v.number()),
  headCommitId: v.optional(v.string()),
  remoteHeadSha: v.optional(v.string()),
  latestPayload: v.optional(v.any()),
  updatedAt: v.number(),
};

async function upsertBookmark(
  ctx: MutationCtx,
  userId: string,
  bookmark: {
    postgresBookmarkId: string;
    latestEventId: string;
    repoFullName: string;
    branchName: string;
    title?: string;
    revision: number;
    mergeStatus: "open" | "merged" | "closed";
    githubPrUrl?: string;
    githubPrNumber?: number;
    headCommitId?: string;
    remoteHeadSha?: string;
    latestPayload?: unknown;
    updatedAt: number;
  },
) {
  const existing = await ctx.db
    .query("gxBookmarks")
    .withIndex("by_userId_postgresBookmarkId", (q) =>
      q.eq("userId", userId).eq("postgresBookmarkId", bookmark.postgresBookmarkId),
    )
    .first();

  const nextFields = {
    userId,
    postgresBookmarkId: bookmark.postgresBookmarkId,
    latestEventId: bookmark.latestEventId,
    repoFullName: bookmark.repoFullName,
    branchName: bookmark.branchName,
    title: bookmark.title,
    revision: bookmark.revision,
    mergeStatus: bookmark.mergeStatus,
    githubPrUrl: bookmark.githubPrUrl,
    githubPrNumber: bookmark.githubPrNumber,
    headCommitId: bookmark.headCommitId,
    remoteHeadSha: bookmark.remoteHeadSha,
    latestPayload: bookmark.latestPayload,
    updatedAt: bookmark.updatedAt,
  };

  if (existing) {
    await ctx.db.patch(existing._id, nextFields);
    return;
  }

  await ctx.db.insert("gxBookmarks", nextFields);
}

export const ingestPush = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.optional(v.string()),
    payload: v.any(),
  },
  handler: async (ctx, { userId, sessionId, payload }) => {
    await ctx.db.insert("gxPrPushes", {
      userId,
      sessionId,
      repoFullName: repoFullNameFromPayload(payload),
      payload,
      createdAt: Date.now(),
    });
  },
});

/** Called by gx-cloud after Postgres ingest; auth = valid `gx pr` CLI bearer token. */
export const ingestCliPush = mutation({
  args: {
    token: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { token, payload }) => {
    const tokenHash = await hashToken(token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || session.revokedAt) {
      throw new Error("Unauthorized");
    }

    await ctx.db.insert("gxPrPushes", {
      userId: session.userId,
      sessionId: session._id,
      repoFullName: repoFullNameFromPayload(payload),
      payload,
      createdAt: Date.now(),
    });
  },
});

/** Local gx-cloud dev uploads (GX_CLOUD_API_KEY + GX_WEBHOOK_SECRET). */
export const ingestDevPush = mutation({
  args: {
    devSecret: v.string(),
    userId: v.string(),
    sessionId: v.optional(v.string()),
    payload: v.any(),
  },
  handler: async (ctx, { devSecret, userId, sessionId, payload }) => {
    const expected = process.env.GX_WEBHOOK_SECRET;
    if (!expected || devSecret !== expected) {
      throw new Error("Unauthorized");
    }
    await ctx.db.insert("gxPrPushes", {
      userId,
      sessionId,
      repoFullName: repoFullNameFromPayload(payload),
      payload,
      createdAt: Date.now(),
    });
  },
});

/** Called by gx-cloud after Postgres bookmark upsert; auth = valid `gx pr` CLI bearer token. */
export const ingestCliBookmark = mutation({
  args: {
    token: v.string(),
    bookmark: v.object(bookmarkInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, { token, bookmark }) => {
    const tokenHash = await hashToken(token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || session.revokedAt) {
      throw new Error("Unauthorized");
    }

    await upsertBookmark(ctx, session.userId, bookmark);
    return null;
  },
});

/** Local gx-cloud dev bookmark index updates (GX_CLOUD_API_KEY + GX_WEBHOOK_SECRET). */
export const ingestDevBookmark = mutation({
  args: {
    devSecret: v.string(),
    userId: v.string(),
    sessionId: v.optional(v.string()),
    bookmark: v.object(bookmarkInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, { devSecret, userId, bookmark }) => {
    const expected = process.env.GX_WEBHOOK_SECRET;
    if (!expected || devSecret !== expected) {
      throw new Error("Unauthorized");
    }

    await upsertBookmark(ctx, userId, bookmark);
    return null;
  },
});

/** Remove a bookmark row from Convex when gx-cloud deletes an empty publish. */
export const deleteDevBookmark = mutation({
  args: {
    devSecret: v.string(),
    userId: v.string(),
    postgresBookmarkId: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    branchName: v.optional(v.string()),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const expected = process.env.GX_WEBHOOK_SECRET;
    if (!expected || args.devSecret !== expected) {
      throw new Error("Unauthorized");
    }

    let bookmark = null;
    if (args.postgresBookmarkId) {
      bookmark = await ctx.db
        .query("gxBookmarks")
        .withIndex("by_userId_postgresBookmarkId", (q) =>
          q
            .eq("userId", args.userId)
            .eq("postgresBookmarkId", args.postgresBookmarkId!),
        )
        .first();
    } else if (args.repoFullName && args.branchName) {
      bookmark = await ctx.db
        .query("gxBookmarks")
        .withIndex("by_userId_repo_branch", (q) =>
          q
            .eq("userId", args.userId)
            .eq("repoFullName", args.repoFullName!)
            .eq("branchName", args.branchName!),
        )
        .first();
    } else {
      throw new Error("postgresBookmarkId or repoFullName+branchName required");
    }

    if (!bookmark) {
      return { deleted: false };
    }

    await ctx.db.delete(bookmark._id);
    return { deleted: true };
  },
});

/** Called by gx-cloud when an empty publish removes a bookmark for a CLI session. */
export const deleteCliBookmark = mutation({
  args: {
    token: v.string(),
    repoFullName: v.string(),
    branchName: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { token, repoFullName, branchName }) => {
    const tokenHash = await hashToken(token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || session.revokedAt) {
      throw new Error("Unauthorized");
    }

    const bookmark = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId_repo_branch", (q) =>
        q
          .eq("userId", session.userId)
          .eq("repoFullName", repoFullName)
          .eq("branchName", branchName),
      )
      .first();

    if (!bookmark) {
      return { deleted: false };
    }

    await ctx.db.delete(bookmark._id);
    return { deleted: true };
  },
});

export const listMyPushes = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const pushes = await ctx.db
      .query("gxPrPushes")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return pushes
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((push) => ({
        id: push._id,
        sessionId: push.sessionId,
        repoFullName: push.repoFullName,
        payload: push.payload,
        createdAt: push.createdAt,
      }));
  },
});

export const listMyBookmarks = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("gxBookmarks"),
      postgresBookmarkId: v.string(),
      latestEventId: v.string(),
      repoFullName: v.string(),
      branchName: v.string(),
      title: v.optional(v.string()),
      revision: v.number(),
      mergeStatus: mergeStatusValidator,
      githubPrUrl: v.optional(v.string()),
      githubPrNumber: v.optional(v.number()),
      headCommitId: v.optional(v.string()),
      remoteHeadSha: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const bookmarks = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return bookmarks
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((bookmark) => ({
        id: bookmark._id,
        postgresBookmarkId: bookmark.postgresBookmarkId,
        latestEventId: bookmark.latestEventId,
        repoFullName: bookmark.repoFullName,
        branchName: bookmark.branchName,
        title: bookmark.title,
        revision: bookmark.revision,
        mergeStatus: bookmark.mergeStatus,
        githubPrUrl: bookmark.githubPrUrl,
        githubPrNumber: bookmark.githubPrNumber,
        headCommitId: bookmark.headCommitId,
        remoteHeadSha: bookmark.remoteHeadSha,
        updatedAt: bookmark.updatedAt,
      }));
  },
});

const consoleBookmarkShape = {
  id: v.string(),
  repoFullName: v.string(),
  branchName: v.string(),
  title: v.optional(v.string()),
  revision: v.number(),
  latestEventId: v.string(),
  headCommitId: v.optional(v.string()),
  githubPrUrl: v.optional(v.string()),
  githubPrNumber: v.optional(v.number()),
  remoteHeadSha: v.optional(v.string()),
  mergeStatus: mergeStatusValidator,
  updatedAtMs: v.number(),
};

/** Resolve Postgres bookmark id for a review event (no DATABASE_URL required). */
export const getBookmarkIdForEvent = query({
  args: {
    eventId: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { eventId }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const bookmark = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId_latestEventId", (q) =>
        q.eq("userId", user._id).eq("latestEventId", eventId),
      )
      .first();

    return bookmark?.postgresBookmarkId ?? null;
  },
});

/** Console sidebar list; id is the Postgres bookmark uuid. */
export const listConsoleBookmarks = query({
  args: {
    mergeStatus: v.optional(mergeStatusValidator),
  },
  returns: v.array(v.object(consoleBookmarkShape)),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    let bookmarks = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    if (args.mergeStatus) {
      bookmarks = bookmarks.filter(
        (bookmark) => bookmark.mergeStatus === args.mergeStatus,
      );
    }

    return bookmarks
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((bookmark) => ({
        id: bookmark.postgresBookmarkId,
        repoFullName: bookmark.repoFullName,
        branchName: bookmark.branchName,
        title: bookmark.title,
        revision: bookmark.revision,
        latestEventId: bookmark.latestEventId,
        headCommitId: bookmark.headCommitId,
        githubPrUrl: bookmark.githubPrUrl,
        githubPrNumber: bookmark.githubPrNumber,
        remoteHeadSha: bookmark.remoteHeadSha,
        mergeStatus: bookmark.mergeStatus,
        updatedAtMs: bookmark.updatedAt,
      }));
  },
});

export const getConsoleBookmarkDetail = query({
  args: {
    bookmarkId: v.string(),
    includePayload: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      ...consoleBookmarkShape,
      payload: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const bookmark = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId_postgresBookmarkId", (q) =>
        q.eq("userId", user._id).eq("postgresBookmarkId", args.bookmarkId),
      )
      .first();

    if (!bookmark) {
      return null;
    }

    return {
      id: bookmark.postgresBookmarkId,
      repoFullName: bookmark.repoFullName,
      branchName: bookmark.branchName,
      title: bookmark.title,
      revision: bookmark.revision,
      latestEventId: bookmark.latestEventId,
      headCommitId: bookmark.headCommitId,
      githubPrUrl: bookmark.githubPrUrl,
      githubPrNumber: bookmark.githubPrNumber,
      remoteHeadSha: bookmark.remoteHeadSha,
      mergeStatus: bookmark.mergeStatus,
      updatedAtMs: bookmark.updatedAt,
      payload: args.includePayload ? bookmark.latestPayload : undefined,
    };
  },
});

export const updateConsoleBookmarkTitle = mutation({
  args: {
    bookmarkId: v.string(),
    title: v.string(),
  },
  returns: v.object({
    id: v.string(),
    title: v.string(),
    updatedAtMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const nextTitle = args.title.trim();
    if (!nextTitle) {
      throw new Error("Title is required");
    }
    if (nextTitle.length > 280) {
      throw new Error("Title is too long");
    }

    const bookmark = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId_postgresBookmarkId", (q) =>
        q.eq("userId", user._id).eq("postgresBookmarkId", args.bookmarkId),
      )
      .first();

    if (!bookmark) {
      throw new Error("Bookmark not found");
    }

    const updatedAt = Date.now();
    await ctx.db.patch(bookmark._id, {
      title: nextTitle,
      updatedAt,
    });

    return {
      id: bookmark.postgresBookmarkId,
      title: nextTitle,
      updatedAtMs: updatedAt,
    };
  },
});

export const getBookmarkWithPayload = internalQuery({
  args: {
    userId: v.string(),
    postgresBookmarkId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      repoFullName: v.string(),
      branchName: v.string(),
      title: v.optional(v.string()),
      payload: v.any(),
    }),
  ),
  handler: async (ctx, { userId, postgresBookmarkId }) => {
    const bookmark = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId_postgresBookmarkId", (q) =>
        q.eq("userId", userId).eq("postgresBookmarkId", postgresBookmarkId),
      )
      .first();

    if (!bookmark?.latestPayload) {
      return null;
    }

    return {
      repoFullName: bookmark.repoFullName,
      branchName: bookmark.branchName,
      title: bookmark.title,
      payload: bookmark.latestPayload,
    };
  },
});

export const getPushForMerge = internalQuery({
  args: {
    pushId: v.id("gxPrPushes"),
    userId: v.string(),
  },
  handler: async (ctx, { pushId, userId }) => {
    const push = await ctx.db.get(pushId);
    if (!push || push.userId !== userId) {
      return null;
    }
    return {
      payload: push.payload,
      repoFullName: push.repoFullName,
    };
  },
});

export const updateBookmarkMergeStatusByBranch = internalMutation({
  args: {
    userId: v.string(),
    repoFullName: v.string(),
    branchName: v.string(),
    mergeStatus: mergeStatusValidator,
    remoteHeadSha: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { userId, repoFullName, branchName, mergeStatus, remoteHeadSha },
  ) => {
    const bookmark = await ctx.db
      .query("gxBookmarks")
      .withIndex("by_userId_repo_branch", (q) =>
        q
          .eq("userId", userId)
          .eq("repoFullName", repoFullName)
          .eq("branchName", branchName),
      )
      .first();
    if (!bookmark) {
      return null;
    }

    await ctx.db.patch(bookmark._id, {
      mergeStatus,
      remoteHeadSha,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Dev-only: seed a push from the console without running `gx pr`. */
export const seedDemoPush = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    const now = Date.now();

    await ctx.db.insert("gxPrPushes", {
      userId: user._id,
      sessionId: `demo-${now}`,
      repoFullName: "acme/demo",
      payload: {
        title: "Demo PR from console",
        branch: "feature/demo",
        paths: [
          "src/index.ts",
          "src/components/Button.tsx",
          "README.md",
        ],
        patch: `diff --git a/src/index.ts b/src/index.ts
index 1111111..2222222 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function main() {
+  console.log("hello gx");
   return 0;
 }
`,
      },
      createdAt: now,
    });
  },
});
