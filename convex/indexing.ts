import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const indexJobStatus = v.union(
  v.literal("pending"),
  v.literal("indexing"),
  v.literal("ready"),
  v.literal("failed"),
);

const indexTrigger = v.union(v.literal("connect"), v.literal("merge"));

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
      if (existing.status === "indexing" && args.trigger === "connect") {
        return { jobId: existing._id, shouldEnqueue: false };
      }

      if (existing.status === "ready" && args.trigger === "connect") {
        return { jobId: existing._id, shouldEnqueue: false };
      }

      await ctx.db.patch(existing._id, {
        status: "pending",
        trigger: args.trigger,
        error: undefined,
        defaultBranch: args.defaultBranch ?? existing.defaultBranch,
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

export const updateJobStatus = internalMutation({
  args: {
    fullName: v.string(),
    status: indexJobStatus,
    commitId: v.optional(v.string()),
    filesTotal: v.optional(v.number()),
    filesIndexed: v.optional(v.number()),
    chunksIndexed: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    defaultBranch: v.optional(v.string()),
  },
  handler: async (ctx, { fullName, status, ...fields }) => {
    const job = await ctx.db
      .query("repoIndexJobs")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();

    if (!job) {
      throw new Error(`No index job found for ${fullName}`);
    }

    await ctx.db.patch(job._id, { status, ...fields });
  },
});
