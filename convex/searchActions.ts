"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { verifyGithubRepoAccess } from "./githubAccess";

function getTurboPufferServiceUrl() {
  const url = process.env.TURBO_PUFFER_SERVICE_URL;
  if (!url) {
    throw new Error("TURBO_PUFFER_SERVICE_URL is not set");
  }
  return url.replace(/\/$/, "");
}

function getTurboPufferServiceSecret() {
  const secret = process.env.TURBO_PUFFER_SERVICE_SECRET;
  if (!secret) {
    throw new Error("TURBO_PUFFER_SERVICE_SECRET is not set");
  }
  return secret;
}

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

    const response = await fetch(
      `${getTurboPufferServiceUrl()}/query-review-context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getTurboPufferServiceSecret()}`,
        },
        body: JSON.stringify({
          fullName: args.fullName,
          changedFiles: args.changedFiles,
          symbols: args.symbols,
          prTitle: args.prTitle,
          prBody: args.prBody,
          sessionSummary: args.sessionSummary,
          limit: args.limit ?? 8,
        }),
      },
    );

    if (response.status === 403) {
      throw new Error(`You do not have access to ${args.fullName}.`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Search failed (${response.status}): ${body}`);
    }

    return (await response.json()) as {
      results: Array<{
        id: string;
        file_path: string;
        doc_type: string;
        symbol?: string;
        content: string;
        commit_id: string;
        score: number;
      }>;
    };
  },
});
