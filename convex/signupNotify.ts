import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";

export const getSignupNotification = internalQuery({
  args: {
    notificationId: v.id("signupNotifications"),
  },
  returns: v.union(
    v.object({
      userId: v.string(),
      email: v.string(),
      githubLogin: v.string(),
      source: v.union(v.literal("web"), v.literal("cli")),
      status: v.union(
        v.literal("pending"),
        v.literal("sent"),
        v.literal("failed"),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("signupNotifications", args.notificationId);
    if (!row) {
      return null;
    }
    return {
      userId: row.userId,
      email: row.email,
      githubLogin: row.githubLogin,
      source: row.source,
      status: row.status,
    };
  },
});

export const enqueueSignupNotify = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    githubLogin: v.string(),
    source: v.union(v.literal("web"), v.literal("cli")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await enqueueSignupNotifyHandler(ctx, args);
    return null;
  },
});

export async function enqueueSignupNotifyHandler(
  ctx: MutationCtx,
  args: {
    userId: string;
    email: string;
    githubLogin: string;
    source: "web" | "cli";
  },
): Promise<void> {
  const existing = await ctx.db
    .query("signupNotifications")
    .withIndex("by_userId", (q) => q.eq("userId", args.userId))
    .first();
  if (existing) {
    return;
  }

  const now = Date.now();
  const notificationId = await ctx.db.insert("signupNotifications", {
    userId: args.userId,
    email: args.email,
    githubLogin: args.githubLogin,
    source: args.source,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  await ctx.scheduler.runAfter(0, internal.signupNotifyActions.sendSignupEmail, {
    notificationId,
  });
}

export const markSignupNotificationSent = internalMutation({
  args: {
    notificationId: v.id("signupNotifications"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("signupNotifications", args.notificationId);
    if (!row) {
      return null;
    }
    await ctx.db.patch(args.notificationId, {
      status: "sent",
      sentAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markSignupNotificationFailed = internalMutation({
  args: {
    notificationId: v.id("signupNotifications"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("signupNotifications", args.notificationId);
    if (!row) {
      return null;
    }
    await ctx.db.patch(args.notificationId, {
      status: "failed",
      updatedAt: Date.now(),
    });
    return null;
  },
});
