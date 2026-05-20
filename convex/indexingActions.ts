"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

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

function getCallbackUrl() {
  const siteUrl = process.env.CONVEX_SITE_URL ?? process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error("CONVEX_SITE_URL or SITE_URL is not set");
  }
  return `${siteUrl.replace(/\/$/, "")}/turbo-puffer/callback`;
}

export const enqueueIndexRepo = internalAction({
  args: {
    fullName: v.string(),
    githubId: v.number(),
    trigger: v.union(v.literal("connect"), v.literal("merge")),
    githubAccessToken: v.optional(v.string()),
    commitId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (args.trigger === "connect" && !args.githubAccessToken) {
      throw new Error("githubAccessToken is required for connect-triggered indexing");
    }

    const response = await fetch(`${getTurboPufferServiceUrl()}/index-repo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getTurboPufferServiceSecret()}`,
      },
      body: JSON.stringify({
        fullName: args.fullName,
        githubId: args.githubId,
        commitId: args.commitId,
        trigger: args.trigger,
        githubAccessToken: args.githubAccessToken,
        callbackUrl: getCallbackUrl(),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to enqueue index job (${response.status}): ${body}`,
      );
    }
  },
});
