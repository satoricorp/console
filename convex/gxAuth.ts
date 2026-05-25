import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { hashToken } from "./gxAuthUtils";

export const resolveCliToken = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      userId: v.string(),
      githubUserId: v.optional(v.number()),
      githubLogin: v.optional(v.string()),
      sessionId: v.string(),
      machineId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { token }) => {
    const tokenHash = await hashToken(token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!session || session.revokedAt !== undefined) {
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
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "providerId", value: "github" },
        { field: "accountId", value: String(args.githubUserId) },
      ],
    })) as { userId?: string | null } | null;

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
  returns: v.id("gxCliSessions"),
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

    return await ctx.db.insert("gxCliSessions", {
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
  },
});

export const revokeCliToken = internalMutation({
  args: { token: v.string() },
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx, { token }) => {
    const tokenHash = await hashToken(token);
    const session = await ctx.db
      .query("gxCliSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!session || session.revokedAt) {
      return { revoked: false };
    }

    await ctx.db.patch(session._id, { revokedAt: Date.now() });
    return { revoked: true };
  },
});
