import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import type { Doc } from "./_generated/dataModel";

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

    const appState = await ctx.db
      .query("userAppStates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    const hasConnectedRepos = connected.length > 0;

    return {
      hasConnectedRepos,
      connectedCount: connected.length,
      // Existing users who already connected repos count as completed.
      onboardingCompleted:
        Boolean(appState?.onboardingCompletedAt) || hasConnectedRepos,
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

    const jobsByFullName = new Map<string, Doc<"repoIndexJobs">>();
    for (const fullName of repos.map((r) => r.fullName)) {
      const job = await ctx.db
        .query("repoIndexJobs")
        .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
        .unique();
      if (job) jobsByFullName.set(fullName, job);
    }

    return repos
      .map((repo) => {
        const job = jobsByFullName.get(repo.fullName);
        return {
          id: repo._id,
          githubId: repo.githubId,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          private: repo.private,
          defaultBranch: repo.defaultBranch,
          connectedAt: repo.connectedAt,
          accessVerifiedAt: repo.accessVerifiedAt ?? repo.connectedAt,
          indexStatus: job?.status ?? null,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

export const insertConnectedRepo = internalMutation({
  args: {
    userId: v.string(),
    repo: repoInput,
    accessVerifiedAt: v.number(),
  },
  handler: async (ctx, { userId, repo, accessVerifiedAt }) => {
    const existing = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", repo.fullName),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { accessVerifiedAt });
      return { inserted: false, id: existing._id };
    }

    const id = await ctx.db.insert("connectedRepos", {
      userId,
      githubId: repo.githubId,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      private: repo.private,
      defaultBranch: repo.defaultBranch,
      connectedAt: accessVerifiedAt,
      accessVerifiedAt,
    });

    return { inserted: true, id };
  },
});

export const revokeRepoAccess = internalMutation({
  args: {
    userId: v.string(),
    fullName: v.string(),
  },
  handler: async (ctx, { userId, fullName }) => {
    const existing = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", fullName),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const touchRepoAccessVerified = internalMutation({
  args: {
    userId: v.string(),
    fullName: v.string(),
    accessVerifiedAt: v.number(),
    defaultBranch: v.optional(v.string()),
  },
  handler: async (ctx, { userId, fullName, accessVerifiedAt, defaultBranch }) => {
    const existing = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", fullName),
      )
      .unique();

    if (!existing) return;

    await ctx.db.patch(existing._id, {
      accessVerifiedAt,
      ...(defaultBranch !== undefined ? { defaultBranch } : {}),
    });
  },
});

export const getConnectedRepo = internalQuery({
  args: {
    userId: v.string(),
    fullName: v.string(),
  },
  handler: async (ctx, { userId, fullName }) => {
    return await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", fullName),
      )
      .unique();
  },
});
