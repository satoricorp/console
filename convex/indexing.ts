import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { indexLogMessage, isIndexJobIncomplete } from "./lib/turbopuffer/indexLog";

const indexJobStatus = v.union(
  v.literal("pending"),
  v.literal("indexing"),
  v.literal("ready"),
  v.literal("failed"),
);

const indexTrigger = v.union(v.literal("connect"), v.literal("merge"));

const indexFile = v.object({ path: v.string(), sha: v.string() });

function namespaceForRepo(fullName: string) {
  return `repo-${fullName.replace("/", "-")}`;
}

export const getJobByFullName = internalQuery({
  args: { fullName: v.string() },
  handler: async (ctx, { fullName }) => {
    return await ctx.db
      .query("repoIndexJobs")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();
  },
});

export const getIndexPlan = internalQuery({
  args: { fullName: v.string() },
  handler: async (ctx, { fullName }) => {
    const job = await ctx.db
      .query("repoIndexJobs")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();

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
    fullName: v.string(),
    githubId: v.number(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.optional(v.string()),
    trigger: indexTrigger,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repoIndexJobs")
      .withIndex("by_fullName", (q) => q.eq("fullName", args.fullName))
      .unique();

    if (existing) {
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
      fullName: args.fullName,
      githubId: args.githubId,
      owner: args.owner,
      name: args.name,
      defaultBranch: args.defaultBranch,
      turbopufferNamespace: namespaceForRepo(args.fullName),
      status: "pending",
      trigger: args.trigger,
    });

    return { jobId, shouldEnqueue: true };
  },
});

export const saveIndexPlan = internalMutation({
  args: {
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
    const job = await ctx.db
      .query("repoIndexJobs")
      .withIndex("by_fullName", (q) => q.eq("fullName", args.fullName))
      .unique();

    if (!job) {
      throw new Error(`No index job found for ${args.fullName}`);
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
  handler: async (ctx, { fullName, status, clearIndexFiles, ...fields }) => {
    const job = await ctx.db
      .query("repoIndexJobs")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();

    if (!job) {
      throw new Error(`No index job found for ${fullName}`);
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
