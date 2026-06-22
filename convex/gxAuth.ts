import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { hashToken } from "./gxAuthUtils";

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

export const createDesktopOAuthTicket = internalMutation({
  args: {
    ticket: v.string(),
    state: v.string(),
    githubAccessToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ticketHash = await hashToken(args.ticket);
    await ctx.db.insert("gxDesktopOAuthTickets", {
      ticketHash,
      state: args.state,
      githubAccessToken: args.githubAccessToken,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
  },
});

export const consumeDesktopOAuthTicket = internalMutation({
  args: {
    ticket: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const ticketHash = await hashToken(args.ticket);
    const ticket = await ctx.db
      .query("gxDesktopOAuthTickets")
      .withIndex("by_ticketHash", (q) => q.eq("ticketHash", ticketHash))
      .first();

    if (!ticket || ticket.state !== args.state || ticket.usedAt) {
      return null;
    }

    const now = Date.now();
    if (ticket.expiresAt < now) {
      await ctx.db.patch(ticket._id, { usedAt: now });
      return null;
    }

    await ctx.db.patch(ticket._id, { usedAt: now });
    return {
      githubAccessToken: ticket.githubAccessToken,
    };
  },
});
