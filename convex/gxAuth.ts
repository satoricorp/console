import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { hashToken } from "./gxAuthUtils";

export const resolveCliToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || session.revokedAt) {
      return null;
    }

    await ctx.db.patch(session._id, { lastUsedAt: Date.now() });

    return {
      userId: session.userId,
      githubUserId: session.githubUserId,
      githubLogin: session.githubLogin,
      sessionId: session._id,
      machineId: session.machineId,
    };
  },
});

export const ensureGithubUser = internalMutation({
  args: {
    githubUserId: v.number(),
    githubLogin: v.string(),
    name: v.string(),
    email: v.string(),
    image: v.optional(v.string()),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "providerId", value: "github" },
        { field: "accountId", value: String(args.githubUserId) },
      ],
    })) as { _id?: string; userId?: string | null } | null;

    if (account?.userId) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "account",
          where: [
            { field: "providerId", value: "github" },
            { field: "accountId", value: String(args.githubUserId) },
          ],
          update: {
            accessToken: args.accessToken,
            updatedAt: now,
          },
        },
      });
      return account.userId;
    }

    const user = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: args.name,
          email: args.email,
          emailVerified: true,
          image: args.image ?? null,
          username: args.githubLogin,
          displayUsername: args.githubLogin,
          createdAt: now,
          updatedAt: now,
        },
      },
    })) as { id: string };

    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId: user.id,
          providerId: "github",
          accountId: String(args.githubUserId),
          accessToken: args.accessToken,
          scope: "repo",
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    return user.id;
  },
});

export const finishCliLogin = internalMutation({
  args: {
    userId: v.string(),
    githubUserId: v.number(),
    githubLogin: v.string(),
    machineId: v.string(),
    machineName: v.string(),
    gxVersion: v.optional(v.string()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await hashToken(args.token);

    const existingForMachine = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_userId_machineId", (q) =>
        q.eq("userId", args.userId).eq("machineId", args.machineId),
      )
      .collect();

    for (const session of existingForMachine) {
      if (!session.revokedAt) {
        await ctx.db.patch(session._id, { revokedAt: now });
      }
    }

    const sessionId = await ctx.db.insert("gxCliSessions", {
      userId: args.userId,
      tokenHash,
      githubUserId: args.githubUserId,
      githubLogin: args.githubLogin,
      machineId: args.machineId,
      machineName: args.machineName,
      gxVersion: args.gxVersion,
      createdAt: now,
      lastUsedAt: now,
    });

    return sessionId;
  },
});

export const revokeCliToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || session.revokedAt) {
      return { revoked: false };
    }

    await ctx.db.patch(session._id, { revokedAt: Date.now() });
    return { revoked: true };
  },
});

export const getMyCliSessions = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return null;
    }

    const sessions = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return sessions
      .filter((session) => !session.revokedAt)
      .map((session) => ({
        sessionId: session._id,
        machineId: session.machineId,
        machineName: session.machineName,
        githubLogin: session.githubLogin,
        gxVersion: session.gxVersion,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
      }))
      .sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  },
});

export const revokeMyCliSession = mutation({
  args: {
    sessionId: v.id("gxCliSessions"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id || session.revokedAt) {
      return { revoked: false };
    }

    await ctx.db.patch(session._id, { revokedAt: Date.now() });
    return { revoked: true };
  },
});
