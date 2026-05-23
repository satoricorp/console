"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { runIndexRepo } from "./lib/turbopuffer/runIndexRepo";

function verifyGithubWebhookSignature(
  payload: string,
  signatureHeader: string,
): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected =
    "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

export const indexRepo = internalAction({
  args: {
    fullName: v.string(),
    githubId: v.number(),
    trigger: v.union(v.literal("connect"), v.literal("merge")),
    githubAccessToken: v.optional(v.string()),
    commitId: v.optional(v.string()),
    githubAppInstallationId: v.optional(v.number()),
    batchOffset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.trigger === "connect" && !args.githubAccessToken) {
      throw new Error(
        "githubAccessToken is required for connect-triggered indexing",
      );
    }

    await runIndexRepo(args, {
      updateStatus: async (update) => {
        await ctx.runMutation(internal.indexing.updateJobStatus, update);
      },
      scheduleNextBatch: async (nextOffset) => {
        await ctx.runMutation(internal.indexing.scheduleIndexRepo, {
          ...args,
          batchOffset: nextOffset,
        });
      },
      getPlan: () =>
        ctx.runQuery(internal.indexing.getIndexPlan, {
          fullName: args.fullName,
        }),
      savePlan: async (plan) => {
        await ctx.runMutation(internal.indexing.saveIndexPlan, {
          fullName: args.fullName,
          commitId: plan.commitId,
          defaultBranch: plan.branch,
          indexFiles: plan.indexFiles,
          filesSkipped: plan.filesSkipped,
          treeTruncated: plan.treeTruncated,
          startedAt: plan.startedAt,
          chunksIndexed: plan.chunksIndexed,
        });
      },
    });
  },
});

type PushEvent = {
  ref: string;
  after: string;
  repository: {
    full_name: string;
    id: number;
    default_branch?: string;
  };
  installation?: { id: number };
};

export const handleGithubWebhook = internalAction({
  args: {
    payload: v.string(),
    signature: v.string(),
    event: v.string(),
  },
  handler: async (ctx, { payload, signature, event }) => {
    if (event !== "push") return;

    if (!verifyGithubWebhookSignature(payload, signature)) {
      throw new Error("Invalid GitHub webhook signature");
    }

    const body = JSON.parse(payload) as PushEvent;
    const fullName = body.repository.full_name;
    const defaultBranch = body.repository.default_branch ?? "main";

    if (body.ref !== `refs/heads/${defaultBranch}`) return;
    if (body.after === "0000000000000000000000000000000000000000") return;

    const job = await ctx.runQuery(internal.indexing.getJobByFullName, {
      fullName,
    });
    if (!job) return;

    await ctx.runMutation(internal.indexing.scheduleIndexRepo, {
      fullName,
      githubId: body.repository.id,
      trigger: "merge",
      commitId: body.after,
      githubAppInstallationId: body.installation?.id,
    });
  },
});
