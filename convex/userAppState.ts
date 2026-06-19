import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const getMyAppState = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const state = await ctx.db
      .query("userAppStates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    return {
      downloadScreenCompleted: Boolean(state?.downloadScreenCompletedAt),
      downloadScreenCompletedAt: state?.downloadScreenCompletedAt ?? null,
    };
  },
});

export const completeDownloadScreen = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await ctx.db
      .query("userAppStates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        downloadScreenCompletedAt: existing.downloadScreenCompletedAt ?? now,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("userAppStates", {
      userId: user._id,
      createdAt: now,
      downloadScreenCompletedAt: now,
      updatedAt: now,
    });
  },
});
