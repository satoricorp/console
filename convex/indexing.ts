import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { indexLogMessage, isIndexJobIncomplete, STALL_WATCHDOG_MS } from "./lib/turbopuffer/indexLog";

const indexJobStatus = v.union(
  v.literal("pending"),
  v.literal("indexing"),
  v.literal("ready"),
  v.literal("failed"),
);

const indexTrigger = v.union(v.literal("connect"), v.literal("merge"));

const indexFile = v.object({ path: v.string(), sha: v.string() });

/**
 * The TurboPuffer namespace for one org's copy of a repository.
 *
 * This is the same name the GX Cloud server builds in
 * `server/src/indexing/config.ts` and the gx CLI builds in
 * `internal/semantic/config.go`, so all three writers and every reader address
 * one namespace. It used to be `repo-{owner}-{repo}`, which had no org in it:
 * two orgs with access to the same repository shared one index and the
 * commit-id sweep had them deleting each other's rows, and the server's PR
 * summaries never read it at all because they look up `gx-{orgId}-…`.
 */
export function namespaceForOrgRepo(orgId: string, fullName: string) {
  const slug = fullName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().replace(/^-|-$/g, "");
  return `gx-${orgId}-${slug}-v2`;
}

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
    };
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

      if (existing.status === "ready" && args.trigger === "connect") {
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
    indexLog: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, fullName, status, clearIndexFiles, ...fields }) => {
    const job = await findJob(ctx, orgId, fullName);

    if (!job) {
      throw new Error(`No index job found for ${fullName} in org ${orgId}`);
    }

    await ctx.db.patch(job._id, {
      status,
      ...fields,
      ...(clearIndexFiles ? { indexFiles: undefined } : {}),
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
