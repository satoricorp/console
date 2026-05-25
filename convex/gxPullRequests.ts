import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { authComponent } from "./auth";

const gxAddInput = v.object({
  order: v.number(),
  changeId: v.optional(v.string()),
  jjChangeId: v.optional(v.string()),
  currentCommitId: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  branchName: v.optional(v.string()),
  baseBranchName: v.optional(v.string()),
  githubPullRequestUrl: v.optional(v.string()),
  files: v.array(v.string()),
  patch: v.optional(v.string()),
  debugJson: v.string(),
});

const gxAddResult = v.object({
  id: v.id("gxAdds"),
  createdAt: v.number(),
  order: v.number(),
  changeId: v.optional(v.string()),
  jjChangeId: v.optional(v.string()),
  currentCommitId: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  branchName: v.optional(v.string()),
  baseBranchName: v.optional(v.string()),
  githubPullRequestUrl: v.optional(v.string()),
  files: v.array(v.string()),
  patch: v.optional(v.string()),
  debugJson: v.string(),
});

const gxPullRequestCard = v.object({
  id: v.id("gxPullRequests"),
  requestId: v.string(),
  event: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  gxVersion: v.optional(v.string()),
  repoRootPath: v.optional(v.string()),
  repoBackend: v.optional(v.string()),
  repoRemoteUrl: v.optional(v.string()),
  repoBranchName: v.optional(v.string()),
  headCommitId: v.optional(v.string()),
  githubPullRequestUrl: v.optional(v.string()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  addCount: v.number(),
});

const gxPullRequestDetail = v.object({
  id: v.id("gxPullRequests"),
  requestId: v.string(),
  event: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  gxVersion: v.optional(v.string()),
  repoRootPath: v.optional(v.string()),
  repoBackend: v.optional(v.string()),
  repoRemoteUrl: v.optional(v.string()),
  repoBranchName: v.optional(v.string()),
  headCommitId: v.optional(v.string()),
  githubPullRequestUrl: v.optional(v.string()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  addCount: v.number(),
  debugJson: v.string(),
});

export const upsertFromPr = internalMutation({
  args: {
    userId: v.string(),
    requestId: v.string(),
    event: v.string(),
    createdAt: v.number(),
    gxVersion: v.optional(v.string()),
    repoRootPath: v.optional(v.string()),
    repoBackend: v.optional(v.string()),
    repoRemoteUrl: v.optional(v.string()),
    repoBranchName: v.optional(v.string()),
    headCommitId: v.optional(v.string()),
    githubPullRequestUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    debugJson: v.string(),
    adds: v.array(gxAddInput),
  },
  returns: v.object({
    id: v.id("gxPullRequests"),
    inserted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("gxPullRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();

    const fields = {
      userId: args.userId,
      event: args.event,
      createdAt: args.createdAt,
      updatedAt: now,
      gxVersion: args.gxVersion,
      repoRootPath: args.repoRootPath,
      repoBackend: args.repoBackend,
      repoRemoteUrl: args.repoRemoteUrl,
      repoBranchName: args.repoBranchName,
      headCommitId: args.headCommitId,
      githubPullRequestUrl: args.githubPullRequestUrl,
      title: args.title,
      description: args.description,
      status: args.status,
      addCount: args.adds.length,
      debugJson: args.debugJson,
    };

    const gxPullRequestId = existing
      ? existing._id
      : await ctx.db.insert("gxPullRequests", {
          requestId: args.requestId,
          ...fields,
        });

    if (existing) {
      if (existing.userId !== args.userId) {
        throw new Error("PR event request id is already owned by another user");
      }

      await ctx.db.patch(existing._id, fields);

      const previousAdds = await ctx.db
        .query("gxAdds")
        .withIndex("by_gxPullRequestId", (q) =>
          q.eq("gxPullRequestId", existing._id),
        )
        .collect();
      for (const add of previousAdds) {
        await ctx.db.delete(add._id);
      }
    }

    for (const add of args.adds) {
      await ctx.db.insert("gxAdds", {
        gxPullRequestId,
        userId: args.userId,
        createdAt: args.createdAt,
        ...add,
      });
    }

    return { id: gxPullRequestId, inserted: !existing };
  },
});

export const listMine = query({
  args: {},
  returns: v.array(gxPullRequestCard),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const rows = await ctx.db
      .query("gxPullRequests")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);

    return rows.map((row) => ({
      id: row._id,
      requestId: row.requestId,
      event: row.event,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      gxVersion: row.gxVersion,
      repoRootPath: row.repoRootPath,
      repoBackend: row.repoBackend,
      repoRemoteUrl: row.repoRemoteUrl,
      repoBranchName: row.repoBranchName,
      headCommitId: row.headCommitId,
      githubPullRequestUrl: row.githubPullRequestUrl,
      title: row.title,
      description: row.description,
      status: row.status,
      addCount: row.addCount,
    }));
  },
});

export const getMineWithAdds = query({
  args: { id: v.id("gxPullRequests") },
  returns: v.union(
    v.object({
      pr: gxPullRequestDetail,
      adds: v.array(gxAddResult),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const row = await ctx.db.get(id);
    if (!row || row.userId !== user._id) return null;

    const adds = await ctx.db
      .query("gxAdds")
      .withIndex("by_gxPullRequestId", (q) => q.eq("gxPullRequestId", id))
      .collect();

    return {
      pr: {
        id: row._id,
        requestId: row.requestId,
        event: row.event,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        gxVersion: row.gxVersion,
        repoRootPath: row.repoRootPath,
        repoBackend: row.repoBackend,
        repoRemoteUrl: row.repoRemoteUrl,
        repoBranchName: row.repoBranchName,
        headCommitId: row.headCommitId,
        githubPullRequestUrl: row.githubPullRequestUrl,
        title: row.title,
        description: row.description,
        status: row.status,
        addCount: row.addCount,
        debugJson: row.debugJson,
      },
      adds: adds
        .sort((a, b) => a.order - b.order)
        .map((add) => ({
          id: add._id,
          createdAt: add.createdAt,
          order: add.order,
          changeId: add.changeId,
          jjChangeId: add.jjChangeId,
          currentCommitId: add.currentCommitId,
          description: add.description,
          status: add.status,
          branchName: add.branchName,
          baseBranchName: add.baseBranchName,
          githubPullRequestUrl: add.githubPullRequestUrl,
          files: add.files,
          patch: add.patch,
          debugJson: add.debugJson,
        })),
    };
  },
});
