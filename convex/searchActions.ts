"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { verifyGithubRepoAccess } from "./githubAccess";
import { queryReviewContext as searchTurboPuffer } from "./lib/turbopuffer/queryReviewContext";

export const queryReviewContext = action({
  args: {
    fullName: v.string(),
    changedFiles: v.array(v.string()),
    symbols: v.optional(v.array(v.string())),
    prTitle: v.optional(v.string()),
    prBody: v.optional(v.string()),
    sessionSummary: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);

    const grant = await ctx.runQuery(internal.repos.getConnectedRepo, {
      userId: user._id,
      fullName: args.fullName,
    });

    if (!grant) {
      throw new Error(`You do not have access to ${args.fullName}.`);
    }

    const verification = await verifyGithubRepoAccess(
      ctx,
      user._id,
      args.fullName,
    );

    if (!verification.ok) {
      await ctx.runMutation(internal.repos.revokeRepoAccess, {
        userId: user._id,
        fullName: args.fullName,
      });
      throw new Error(verification.message);
    }

    await ctx.runMutation(internal.repos.touchRepoAccessVerified, {
      userId: user._id,
      fullName: args.fullName,
      accessVerifiedAt: Date.now(),
      defaultBranch: verification.defaultBranch,
    });

    return searchTurboPuffer({
      fullName: args.fullName,
      changedFiles: args.changedFiles,
      symbols: args.symbols,
      prTitle: args.prTitle,
      prBody: args.prBody,
      sessionSummary: args.sessionSummary,
      limit: args.limit ?? 8,
    });
  },
});
