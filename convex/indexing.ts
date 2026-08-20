import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { indexLogMessage, isIndexJobIncomplete, STALL_WATCHDOG_MS } from "./lib/turbopuffer/indexLog";
import { namespaceForOrgRepo } from "./lib/turbopuffer/utils";

const indexJobStatus = v.union(
  v.literal("pending"),
  v.literal("indexing"),
  v.literal("ready"),
  v.literal("failed"),
);

const indexTrigger = v.union(v.literal("connect"), v.literal("merge"));

const indexFile = v.object({ path: v.string(), sha: v.string() });

/**
 * Finds a repository's index job within an org, adopting a pre-org row if it
 * finds one.
 *
 * Rows written before org identity carry no orgId, and there is at most one per
 * repository because fullName used to be globally unique. Claiming it on first
 * touch migrates it in place rather than orphaning an indexed repository behind
 * a lookup that can no longer see it. `.unique()` is deliberately not used on
 * the legacy index: once two orgs have rows for one repository it would throw.
 */
async function findJob(
  ctx: { db: any },
  orgId: string,
  fullName: string,
): Promise<any | null> {
  const scoped = await ctx.db
    .query("repoIndexJobs")
    .withIndex("by_org_fullName", (q: any) => q.eq("orgId", orgId).eq("fullName", fullName))
    .unique();
  if (scoped) {
    return scoped;
  }
  return await ctx.db
    .query("repoIndexJobs")
    .withIndex("by_fullName", (q: any) => q.eq("fullName", fullName))
    .filter((q: any) => q.eq(q.field("orgId"), undefined))
    .first();
}

export const getJobByFullName = internalQuery({
  args: { orgId: v.string(), fullName: v.string() },
  handler: async (ctx, { orgId, fullName }) => {
    return await findJob(ctx, orgId, fullName);
  },
});

export const getIndexPlan = internalQuery({
  args: { orgId: v.string(), fullName: v.string() },
  handler: async (ctx, { orgId, fullName }) => {
    const job = await findJob(ctx, orgId, fullName);

    if (!job?.indexFiles || !job.commitId || !job.defaultBranch) {
      return null;
    }

    return {
      commitId: job.commitId,
      branch: job.defaultBranch,
      indexFiles: job.indexFiles,
      filesSkipped: job.filesSkipped ?? 0,
      treeTruncated: job.treeTruncated ?? false,
      startedAt: job.startedAt ?? Date.now(),
      chunksIndexed: job.chunksIndexed ?? 0,
      filesIndexed: job.filesIndexed ?? 0,
      // Absent on rows written before incremental passes existed. Those plans
      // were full passes, and false is what makes the resumed sweep correct.
      incremental: job.incremental ?? false,
      repoFileCount: job.repoFileCount ?? job.indexFiles.length,
    };
  },
});

/**
 * The commit this repository's namespace fully reflects, or null if no pass has
 * ever completed.
 *
 * Deliberately not `commitId`, and deliberately not gated on the current status.
 * `commitId` is set when a pass starts, so after a failure it names a commit the
 * index only partly reached. And status is "pending" both after a failure and
 * after a completed pass queued a newer commit — reading it would make every
 * merge that lands during an index rebuild the whole repository.
 */
export const getLastIndexedCommit = internalQuery({
  args: { orgId: v.string(), fullName: v.string() },
  handler: async (ctx, { orgId, fullName }) => {
    const job = await findJob(ctx, orgId, fullName);
    const commitId = job?.lastIndexedCommitId;
    return typeof commitId === "string" && commitId ? commitId : null;
  },
});

export const ensureIndexJob = internalMutation({
  args: {
    orgId: v.string(),
    fullName: v.string(),
    githubId: v.number(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.optional(v.string()),
    trigger: indexTrigger,
    // Re-index an already-ready repository. Without it the ready short-circuit
    // below makes an explicit re-index request a no-op, which is the one case
    // someone actually asks for one.
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await findJob(ctx, args.orgId, args.fullName);

    if (existing) {
      // Claim a pre-org row and move it onto this org's namespace. Leaving the
      // old name in place would keep writing to an index nothing reads.
      if (!existing.orgId) {
        await ctx.db.patch(existing._id, {
          orgId: args.orgId,
          turbopufferNamespace: namespaceForOrgRepo(args.orgId, args.fullName),
        });
      }
      if (isIndexJobIncomplete(existing)) {
        const batchOffset = existing.filesIndexed ?? 0;
        const line = indexLogMessage(
          args.fullName,
          {
            commitId: existing.commitId,
            filesIndexed: batchOffset,
            filesTotal: existing.filesTotal,
            chunksIndexed: existing.chunksIndexed,
            batchOffset,
          },
          "Job incomplete — will resume where we left off",
        );
        console.log(line);
        await ctx.db.patch(existing._id, { indexLog: line });
        return { jobId: existing._id, shouldEnqueue: true, batchOffset };
      }

      if (existing.status === "indexing" && args.trigger === "connect") {
        const line = indexLogMessage(
          args.fullName,
          { commitId: existing.commitId },
          "Index stalled with no checkpoint — restarting from beginning",
        );
        console.log(line);
        await ctx.db.patch(existing._id, {
          status: "pending",
          indexLog: line,
          indexFiles: undefined,
          filesIndexed: undefined,
          filesTotal: undefined,
          chunksIndexed: undefined,
          error: undefined,
        });
        return { jobId: existing._id, shouldEnqueue: true, batchOffset: 0 };
      }

      if (existing.status === "ready" && args.trigger === "connect" && !args.force) {
        return { jobId: existing._id, shouldEnqueue: false };
      }

      await ctx.db.patch(existing._id, {
        status: "pending",
        trigger: args.trigger,
        error: undefined,
        defaultBranch: args.defaultBranch ?? existing.defaultBranch,
        indexFiles: undefined,
        filesSkipped: undefined,
        treeTruncated: undefined,
      });
      return { jobId: existing._id, shouldEnqueue: true };
    }

    const jobId = await ctx.db.insert("repoIndexJobs", {
      orgId: args.orgId,
      fullName: args.fullName,
      githubId: args.githubId,
      owner: args.owner,
      name: args.name,
      defaultBranch: args.defaultBranch,
      turbopufferNamespace: namespaceForOrgRepo(args.orgId, args.fullName),
      status: "pending",
      trigger: args.trigger,
    });

    return { jobId, shouldEnqueue: true };
  },
});

export const saveIndexPlan = internalMutation({
  args: {
    orgId: v.string(),
    fullName: v.string(),
    commitId: v.string(),
    defaultBranch: v.string(),
    indexFiles: v.array(indexFile),
    filesSkipped: v.number(),
    treeTruncated: v.boolean(),
    startedAt: v.number(),
    chunksIndexed: v.number(),
    filesIndexed: v.number(),
    incremental: v.boolean(),
    repoFileCount: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.orgId, args.fullName);

    if (!job) {
      throw new Error(`No index job found for ${args.fullName} in org ${args.orgId}`);
    }

    await ctx.db.patch(job._id, {
      commitId: args.commitId,
      defaultBranch: args.defaultBranch,
      indexFiles: args.indexFiles,
      filesSkipped: args.filesSkipped,
      treeTruncated: args.treeTruncated,
      startedAt: args.startedAt,
      filesTotal: args.indexFiles.length,
      filesIndexed: args.filesIndexed,
      chunksIndexed: args.chunksIndexed,
      incremental: args.incremental,
      repoFileCount: args.repoFileCount,
    });
  },
});

export const updateJobStatus = internalMutation({
  args: {
    orgId: v.string(),
    fullName: v.string(),
    status: indexJobStatus,
    commitId: v.optional(v.string()),
    filesTotal: v.optional(v.number()),
    filesIndexed: v.optional(v.number()),
    chunksIndexed: v.optional(v.number()),
    filesSkipped: v.optional(v.number()),
    treeTruncated: v.optional(v.boolean()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    defaultBranch: v.optional(v.string()),
    clearIndexFiles: v.optional(v.boolean()),
    // Drops a stale `error` from an earlier attempt. `error: undefined` cannot
    // do this over the wire — Convex omits undefined args, so the field is not
    // in `fields` at all and the patch leaves the old value in place. Without
    // it a failure outlives the pass that fixed it: satoricorp/gx carried a
    // 77KB ArgumentValidationError while sitting at status "ready".
    clearError: v.optional(v.boolean()),
    indexLog: v.optional(v.string()),
    lastIndexedCommitId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { orgId, fullName, status, clearIndexFiles, clearError, ...fields },
  ) => {
    const job = await findJob(ctx, orgId, fullName);

    if (!job) {
      throw new Error(`No index job found for ${fullName} in org ${orgId}`);
    }

    // Adopt a pre-org row here as well as in ensureIndexJob. A merge schedules
    // indexing directly and never goes through ensureIndexJob, so a repository
    // connected before org identity would index correctly — the namespace is
    // computed from the org passed in, not from the stored field — while its
    // row kept no orgId and advertised the retired repo-{owner}-{repo} name
    // forever. That is what the console reads back to show where an index
    // lives, and it is what a second org indexing the same repository would
    // collide with.
    const adopt = job.orgId
      ? {}
      : {
          orgId,
          turbopufferNamespace: namespaceForOrgRepo(orgId, fullName),
        };

    await ctx.db.patch(job._id, {
      status,
      ...adopt,
      ...fields,
      ...(clearIndexFiles ? { indexFiles: undefined } : {}),
      ...(clearError ? { error: undefined } : {}),
    });
  },
});

export const scheduleIndexRepo = internalMutation({
  args: {
    orgId: v.string(),
    fullName: v.string(),
    githubId: v.number(),
    trigger: indexTrigger,
    githubAccessToken: v.optional(v.string()),
    commitId: v.optional(v.string()),
    githubAppInstallationId: v.optional(v.number()),
    batchOffset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.indexingActions.indexRepo, args);
  },
});

const stallWatchdogArgs = {
  orgId: v.string(),
  fullName: v.string(),
  githubId: v.number(),
  trigger: indexTrigger,
  checkpoint: v.number(),
  commitId: v.optional(v.string()),
  githubAccessToken: v.optional(v.string()),
  githubAppInstallationId: v.optional(v.number()),
};

export const scheduleStallWatchdog = internalMutation({
  args: stallWatchdogArgs,
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      STALL_WATCHDOG_MS,
      internal.indexing.resumeIfStalled,
      args,
    );
  },
});

export const resumeIfStalled = internalMutation({
  args: stallWatchdogArgs,
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.orgId, args.fullName);

    if (!job || !isIndexJobIncomplete(job)) return;
    if ((job.filesIndexed ?? 0) > args.checkpoint) return;

    const batchOffset = job.filesIndexed ?? args.checkpoint;
    const line = indexLogMessage(
      args.fullName,
      {
        commitId: job.commitId,
        filesIndexed: batchOffset,
        filesTotal: job.filesTotal,
        chunksIndexed: job.chunksIndexed,
        batchOffset,
      },
      "Stalled (timeout/killed) — auto-resuming",
    );
    console.log(line);

    await ctx.db.patch(job._id, { indexLog: line });

    await ctx.scheduler.runAfter(0, internal.indexingActions.indexRepo, {
      orgId: args.orgId,
      fullName: args.fullName,
      githubId: args.githubId,
      trigger: args.trigger,
      commitId: args.commitId ?? job.commitId,
      githubAccessToken: args.githubAccessToken,
      githubAppInstallationId: args.githubAppInstallationId,
      batchOffset,
    });
  },
});

/**
 * Records a merge that arrived while this repository was already indexing.
 *
 * Not a queue: three merges during one pass leave the newest, because indexing
 * commit C supersedes A and B. Two runs at once would be worse than a delayed
 * one — they address the same rows and each one's stale sweep would delete the
 * other's work.
 *
 * Skipping outright is the tempting alternative and is wrong: the running pass
 * finishes at its own commit, the newer one is never indexed, and the index
 * sits behind HEAD until someone merges again.
 */
export const queueCommitWhileIndexing = internalMutation({
  args: {
    orgId: v.string(),
    fullName: v.string(),
    commitId: v.string(),
    githubAppInstallationId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.orgId, args.fullName);
    if (!job) return;
    if (job.commitId === args.commitId) return;

    await ctx.db.patch(job._id, {
      queuedCommitId: args.commitId,
      queuedInstallationId: args.githubAppInstallationId,
      queuedAt: Date.now(),
    });
  },
});

/**
 * Starts the commit that landed mid-run, if one did. Called once a pass has
 * finalized, so there is never more than one indexing pass per repository.
 */
export const drainQueuedCommit = internalMutation({
  args: { orgId: v.string(), fullName: v.string() },
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.orgId, args.fullName);
    const queued = job?.queuedCommitId;

    // Stale unless it arrived while the run that just ended was going. A
    // queued commit left behind by an earlier failed pass is an ancestor of
    // what was just indexed, and starting it would walk the index backwards to
    // a commit the repository has already moved past.
    const arrivedDuringThisRun =
      typeof job?.queuedAt === "number" &&
      typeof job?.startedAt === "number" &&
      job.queuedAt >= job.startedAt;

    if (!job || !queued || queued === job.commitId || !arrivedDuringThisRun) {
      if (job?.queuedCommitId) {
        await ctx.db.patch(job._id, {
          queuedCommitId: undefined,
          queuedInstallationId: undefined,
          queuedAt: undefined,
        });
      }
      return;
    }

    await ctx.db.patch(job._id, {
      queuedCommitId: undefined,
      queuedInstallationId: undefined,
      queuedAt: undefined,
      status: "pending",
      indexFiles: undefined,
      filesIndexed: undefined,
      filesTotal: undefined,
      chunksIndexed: undefined,
      error: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.indexingActions.indexRepo, {
      orgId: args.orgId,
      fullName: args.fullName,
      githubId: job.githubId,
      trigger: "merge" as const,
      commitId: queued,
      githubAppInstallationId: job.queuedInstallationId,
    });
  },
});
