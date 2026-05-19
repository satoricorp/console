import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

const repoInput = v.object({
  githubId: v.number(),
  owner: v.string(),
  name: v.string(),
  fullName: v.string(),
  private: v.boolean(),
  defaultBranch: v.optional(v.string()),
});

export const getOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const connected = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return {
      hasConnectedRepos: connected.length > 0,
      connectedCount: connected.length,
    };
  },
});

export const getMyConnectedRepos = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const repos = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return repos
      .map((repo) => ({
        id: repo._id,
        githubId: repo.githubId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        connectedAt: repo.connectedAt,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

export const connectRepos = mutation({
  args: {
    repos: v.array(repoInput),
  },
  handler: async (ctx, { repos }) => {
    const user = await authComponent.getAuthUser(ctx);
    const now = Date.now();

    for (const repo of repos) {
      const existing = await ctx.db
        .query("connectedRepos")
        .withIndex("by_userId_fullName", (q) =>
          q.eq("userId", user._id).eq("fullName", repo.fullName),
        )
        .unique();

      if (existing) continue;

      await ctx.db.insert("connectedRepos", {
        userId: user._id,
        githubId: repo.githubId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        connectedAt: now,
      });
    }
  },
});
