"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
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
      getLastIndexedCommit: () =>
        ctx.runQuery(internal.indexing.getLastIndexedCommit, {
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
          incremental: plan.incremental,
          repoFileCount: plan.repoFileCount,
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
  // `installation` carries the full set on create; `installation_repositories`
  // carries only the delta. Both name the repositories this installation now
  // covers, which is what makes a connect-before-install repairable without
  // scanning connectedRepos for an owner it has no index on.
  repositories?: Array<{ full_name?: string }>;
  repositories_added?: Array<{ full_name?: string }>;
};

/**
 * Indexes a repository that someone connected but that has no job yet.
 *
 * Indexing stays opt-in — this does nothing for a repository nobody connected.
 * What it closes is the gap between the two halves of opting in: connectRepos
 * writes connectedRepos immediately but can only create an index job once an
 * org resolves, and the org isn't knowable until the App is installed on the
 * owner. Connect first, install second, and the repository sits connected and
 * permanently unindexed — the console shows "Not indexed", `gx review` sees
 * only the diff, and no push ever repairs it because the push path treated a
 * missing job as "not opted in".
 *
 * Runs as a merge trigger: there is no user OAuth token here, and the
 * installation token is exactly the credential the App is for. No commitId, so
 * the pass resolves the default branch head — which on the push path is the
 * commit that just landed.
 */
async function indexConnectedRepoIfMissing(
  ctx: ActionCtx,
  args: {
    orgId: string;
    fullName: string;
    installationId?: number;
    githubId?: number;
    defaultBranch?: string;
  },
): Promise<void> {
  const existing = await ctx.runQuery(internal.indexing.getJobByFullName, {
    orgId: args.orgId,
    fullName: args.fullName,
  });
  if (existing) return;

  const connected = await ctx.runQuery(internal.repos.listConnectedByFullName, {
    fullName: args.fullName,
  });
  const row = connected[0];
  if (!row) return;

  const { shouldEnqueue } = await ctx.runMutation(
    internal.indexing.ensureIndexJob,
    {
      orgId: args.orgId,
      fullName: args.fullName,
      githubId: args.githubId ?? row.githubId,
      owner: row.owner,
      name: row.name,
      defaultBranch: args.defaultBranch ?? row.defaultBranch,
      trigger: "merge",
    },
  );
  if (!shouldEnqueue) return;

  await ctx.runMutation(internal.indexing.scheduleIndexRepo, {
    orgId: args.orgId,
    fullName: args.fullName,
    githubId: args.githubId ?? row.githubId,
    trigger: "merge",
    githubAppInstallationId: args.installationId,
  });
}

export const handleGithubWebhook = internalAction({
  args: {
    payload: v.string(),
    signature: v.string(),
    event: v.string(),
    // The org the gx Cloud server resolved from Postgres, which owns this
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

      // The repositories this installation now covers. Anyone who connected one
      // of them before installing has a row with no installation and no index
      // job; this is the first moment either is knowable. Waiting for a push
      // instead would leave a repository the user already opted in unindexed
      // for as long as nobody merges to its default branch.
      const covered = [
        ...(body.repositories ?? []),
        ...(body.repositories_added ?? []),
      ];
      for (const repo of covered) {
        const fullName = repo.full_name;
        if (!fullName) continue;
        await ctx.runMutation(internal.repos.backfillInstallationId, {
          fullName,
          installationId,
        });
        await indexConnectedRepoIfMissing(ctx, {
          orgId,
          fullName,
          installationId,
        });
      }
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
    // our initiative. `gx review` and the PR summary say so, and say where to
    // connect it.
    //
    // A missing job is not the same as "not connected", though — it is also
    // what a connect-before-install leaves behind. Treating the two as one is
    // what made that state permanent, so this asks connectedRepos rather than
    // returning on the job alone, and repairs the installation stamp while it
    // has one in hand.
    const job = await ctx.runQuery(internal.indexing.getJobByFullName, {
      orgId: resolvedOrgId,
      fullName,
    });
    if (!job) {
      if (typeof installationId === "number") {
        await ctx.runMutation(internal.repos.backfillInstallationId, {
          fullName,
          installationId,
        });
      }
      await indexConnectedRepoIfMissing(ctx, {
        orgId: resolvedOrgId,
        fullName,
        installationId,
        githubId: body.repository.id,
        defaultBranch,
      });
      return;
    }

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
