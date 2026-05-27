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
