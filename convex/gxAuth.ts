import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { betterAuthUserIdFromCreateResult, hashToken } from "./gxAuthUtils";

export const ensureGithubUser = internalMutation({
  args: {
    githubUserId: v.number(),
    githubLogin: v.string(),
    name: v.string(),
    email: v.string(),
    avatarURL: v.optional(v.string()),
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
          image: args.avatarURL ?? null,
          username: args.githubLogin,
          displayUsername: args.githubLogin,
          createdAt: now,
          updatedAt: now,
        },
      },
    })) as { _id?: string; id?: string; userId?: string | null };
    const userId = betterAuthUserIdFromCreateResult(user);

    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId,
          providerId: "github",
          accountId: String(args.githubUserId),
          accessToken: args.accessToken,
          scope: "repo",
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    return userId;
  },
});

export const createCliSession = internalMutation({
  args: {
    token: v.string(),
    userId: v.string(),
    githubUserId: v.number(),
    githubLogin: v.string(),
    machineId: v.string(),
    machineName: v.string(),
    gxVersion: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const now = Date.now();
    const existingSessions = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const session of existingSessions) {
      const active =
        !session.revokedAt && session.expiresAt && session.expiresAt > now;
      if (active && session.machineId === args.machineId) {
        await ctx.db.patch(session._id, { revokedAt: now });
      }
    }

    await ctx.db.insert("gxCliSessions", {
      tokenHash,
      userId: args.userId,
      githubUserId: args.githubUserId,
      githubLogin: args.githubLogin,
      machineId: args.machineId,
      machineName: args.machineName,
      gxVersion: args.gxVersion,
      createdAt: now,
      expiresAt: args.expiresAt,
    });
  },
});

export const verifyCliSession = internalMutation({
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

    const now = Date.now();
    if (!session.expiresAt || session.expiresAt <= now) {
      await ctx.db.patch(session._id, { revokedAt: now });
      return null;
    }

    await ctx.db.patch(session._id, { lastUsedAt: now });
    return {
      sessionId: session._id,
      userId: session.userId,
      githubUserId: session.githubUserId,
      githubLogin: session.githubLogin,
      machineId: session.machineId,
      machineName: session.machineName,
      expiresAt: session.expiresAt,
    };
  },
});
