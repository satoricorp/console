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
    orgId: v.string(),
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
        await ctx.runMutation(internal.indexing.updateJobStatus, {
          ...update,
          orgId: args.orgId,
        });
      },
      scheduleNextBatch: async (nextOffset) => {
        await ctx.runMutation(internal.indexing.scheduleIndexRepo, {
          ...args,
          batchOffset: nextOffset,
        });
      },
      scheduleStallWatchdog: async (checkpoint) => {
        await ctx.runMutation(internal.indexing.scheduleStallWatchdog, {
          orgId: args.orgId,
          fullName: args.fullName,
          githubId: args.githubId,
          trigger: args.trigger,
          checkpoint,
          commitId: args.commitId,
          githubAccessToken: args.githubAccessToken,
          githubAppInstallationId: args.githubAppInstallationId,
        });
      },
      getPlan: () =>
        ctx.runQuery(internal.indexing.getIndexPlan, {
          orgId: args.orgId,
          fullName: args.fullName,
        }),
      drainQueuedCommit: async () => {
        await ctx.runMutation(internal.indexing.drainQueuedCommit, {
          orgId: args.orgId,
          fullName: args.fullName,
        });
      },
      savePlan: async (plan) => {
        await ctx.runMutation(internal.indexing.saveIndexPlan, {
          orgId: args.orgId,
          fullName: args.fullName,
          commitId: plan.commitId,
          defaultBranch: plan.branch,
          indexFiles: plan.indexFiles,
          filesSkipped: plan.filesSkipped,
          treeTruncated: plan.treeTruncated,
          startedAt: plan.startedAt,
          chunksIndexed: plan.chunksIndexed,
          filesIndexed: plan.filesIndexed,
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

type InstallationEvent = {
  installation?: { id: number; account?: { login?: string } };
};

export const handleGithubWebhook = internalAction({
  args: {
    payload: v.string(),
    signature: v.string(),
    event: v.string(),
    // The org the TX Cloud server resolved from Postgres, which owns this
    // mapping. Optional because a delivery can arrive before the installation
    // is recorded there, in which case the stored projection is used instead.
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, { payload, signature, event, orgId }) => {
    // Verified before the event is looked at. The filter used to come first,
    // which meant an unsigned body decided whether it was worth checking the
    // signature — harmless while only one event was handled, and not a
    // property worth relying on now that three are.
    if (!verifyGithubWebhookSignature(payload, signature)) {
      throw new Error("Invalid GitHub webhook signature");
    }

    if (event === "installation" || event === "installation_repositories") {
      const body = JSON.parse(payload) as InstallationEvent;
      const installationId = body.installation?.id;
      if (typeof installationId !== "number" || !orgId) return;
      await ctx.runMutation(internal.orgs.upsertInstallationOrg, {
        installationId,
        orgId,
        accountLogin: body.installation?.account?.login,
      });
      return;
    }

    if (event !== "push") return;

    const body = JSON.parse(payload) as PushEvent;
    const fullName = body.repository.full_name;
    const defaultBranch = body.repository.default_branch ?? "main";
    const installationId = body.installation?.id;

    if (body.ref !== `refs/heads/${defaultBranch}`) return;
    if (body.after === "0000000000000000000000000000000000000000") return;

    // Every push repairs the mapping. An installation event can be missed —
    // the App was installed before this forward existed, a delivery failed, a
    // deploy was mid-flight — and without a repair path that installation
    // would never index again.
    if (typeof installationId === "number" && orgId) {
      await ctx.runMutation(internal.orgs.upsertInstallationOrg, {
        installationId,
        orgId,
      });
    }

    const resolvedOrgId =
      orgId ??
      (typeof installationId === "number"
        ? await ctx.runQuery(internal.orgs.getOrgForInstallation, { installationId })
        : null);
    if (!resolvedOrgId) return;

    // Indexing stays opt-in: a repository nobody connected is not indexed on
    // our initiative. `tx review` and the PR summary say so, and say where to
    // connect it.
    const job = await ctx.runQuery(internal.indexing.getJobByFullName, {
      orgId: resolvedOrgId,
      fullName,
    });
    if (!job) return;

    // A pass is already running. Record the newer commit rather than starting
    // a second one against the same rows, and let the running pass pick it up
    // when it finalizes.
    if (job.status === "indexing") {
      await ctx.runMutation(internal.indexing.queueCommitWhileIndexing, {
        orgId: resolvedOrgId,
        fullName,
        commitId: body.after,
        githubAppInstallationId: installationId,
      });
      return;
    }

    await ctx.runMutation(internal.indexing.scheduleIndexRepo, {
      orgId: resolvedOrgId,
      fullName,
      githubId: body.repository.id,
      trigger: "merge",
      commitId: body.after,
      githubAppInstallationId: installationId,
    });
  },
});
