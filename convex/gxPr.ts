import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import { hashToken } from "./gxAuthUtils";
import { repoFullNameFromPayload } from "./lib/gxPrPayload";

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

/** Legacy webhook path; Postgres is the source of truth for PR bookmarks. */
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

export const getBookmarkWithPayload = internalQuery({
  args: {
    userId: v.string(),
    postgresBookmarkId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      repoFullName: v.string(),
      payload: v.any(),
    }),
  ),
  handler: async () => {
    return null;
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
