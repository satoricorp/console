import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import type { Doc } from "./_generated/dataModel";
import { MAX_ERROR_CHARS } from "./lib/turbopuffer/utils";

const repoInput = v.object({
  githubId: v.number(),
  owner: v.string(),
  name: v.string(),
  fullName: v.string(),
  private: v.boolean(),
  defaultBranch: v.optional(v.string()),
});

export const getOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const connected = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    const appState = await ctx.db
      .query("userAppStates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    const hasConnectedRepos = connected.length > 0;

    return {
      hasConnectedRepos,
      connectedCount: connected.length,
      // Indexing a repo is the only thing that completes onboarding. A CLI
      // session used to count too, which quietly locked anyone who had only run
      // the CLI out of the funnel — the gate bounced them off /download before
      // they could reach the repo-connect step. onboardingCompletedAt is
      // stamped whenever a repo is connected, so it survives connectedRepos
      // being cleared by a read-time access check.
      onboardingCompleted:
        Boolean(appState?.onboardingCompletedAt) || hasConnectedRepos,
    };
  },
});

export const getMyConnectedRepos = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const repos = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    // first(), not unique(): fullName stopped being unique when jobs became
    // per-org, so unique() throws the moment two orgs index one repository —
    // taking the whole page down rather than one row. The org filter below is
    // what actually scopes it.
    const jobsByFullName = new Map<string, Doc<"repoIndexJobs">>();
    for (const repo of repos) {
      const installation =
        typeof repo.installationId === "number"
          ? await ctx.db
              .query("orgInstallations")
              .withIndex("by_installationId", (q) =>
                q.eq("installationId", repo.installationId as number),
              )
              .unique()
          : null;
      const job = installation
        ? await ctx.db
            .query("repoIndexJobs")
            .withIndex("by_org_fullName", (q) =>
              q.eq("orgId", installation.orgId).eq("fullName", repo.fullName),
            )
            .unique()
        : await ctx.db
            .query("repoIndexJobs")
            .withIndex("by_fullName", (q) => q.eq("fullName", repo.fullName))
            .first();
      if (job) jobsByFullName.set(repo.fullName, job);
    }

    return repos
      .map((repo) => {
        const job = jobsByFullName.get(repo.fullName);
        return {
          id: repo._id,
          githubId: repo.githubId,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          private: repo.private,
          defaultBranch: repo.defaultBranch,
          connectedAt: repo.connectedAt,
          accessVerifiedAt: repo.accessVerifiedAt ?? repo.connectedAt,
          indexStatus: job?.status ?? null,
          // What the index actually holds, so the page can answer "is this
          // current?" rather than only "did something run once".
          indexedCommitId: job?.commitId ?? null,
          indexedAt: job?.completedAt ?? null,
          indexedFiles: job?.filesIndexed ?? null,
          indexedChunks: job?.chunksIndexed ?? null,
          // Truncated on the way out as well as on the way in. This query is
          // subscribed by the repositories page and the onboarding step, so
          // whatever is in this field crosses the wire to every open tab on
          // every re-execution — and the row it comes from is written ~9 times
          // per index batch. The UI shows this only for a failed index, where
          // the first line is the part worth reading.
          indexError: job?.error ? job.error.slice(0, MAX_ERROR_CHARS) : null,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

export const insertConnectedRepo = internalMutation({
  args: {
    userId: v.string(),
    repo: repoInput,
    accessVerifiedAt: v.number(),
    // Which installation this was connected through, so the org that owns the
    // index namespace can be resolved the same way the webhook path does.
    installationId: v.optional(v.number()),
  },
  handler: async (ctx, { userId, repo, accessVerifiedAt, installationId }) => {
    const existing = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", repo.fullName),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessVerifiedAt,
        ...(installationId === undefined ? {} : { installationId }),
      });
      await markOnboardingCompleted(ctx, userId, accessVerifiedAt);
      return { inserted: false, id: existing._id };
    }

    const id = await ctx.db.insert("connectedRepos", {
      userId,
      githubId: repo.githubId,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      private: repo.private,
      defaultBranch: repo.defaultBranch,
      connectedAt: accessVerifiedAt,
      accessVerifiedAt,
      installationId,
    });

    await markOnboardingCompleted(ctx, userId, accessVerifiedAt);
    return { inserted: true, id };
  },
});

async function markOnboardingCompleted(
  ctx: MutationCtx,
  userId: string,
  now: number,
) {
  const existing = await ctx.db
    .query("userAppStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  if (existing) {
    if (existing.onboardingCompletedAt != null) return;
    await ctx.db.patch(existing._id, {
      onboardingCompletedAt: now,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("userAppStates", {
    userId,
    createdAt: now,
    updatedAt: now,
    onboardingCompletedAt: now,
  });
}

export const touchRepoAccessVerified = internalMutation({
  args: {
    userId: v.string(),
    fullName: v.string(),
    accessVerifiedAt: v.number(),
    defaultBranch: v.optional(v.string()),
  },
  handler: async (ctx, { userId, fullName, accessVerifiedAt, defaultBranch }) => {
    const existing = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", fullName),
      )
      .unique();

    if (!existing) return;

    await ctx.db.patch(existing._id, {
      accessVerifiedAt,
      ...(defaultBranch !== undefined ? { defaultBranch } : {}),
    });
  },
});

export const getConnectedRepo = internalQuery({
  args: {
    userId: v.string(),
    fullName: v.string(),
  },
  handler: async (
    ctx,
    { userId, fullName },
  ): Promise<(Doc<"connectedRepos"> & { orgId: string | null }) | null> => {
    const repo = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId_fullName", (q) =>
        q.eq("userId", userId).eq("fullName", fullName),
      )
      .unique();
    if (!repo) return null;

    // The org is resolved here rather than by a second call from the action:
    // Convex infers an action's return type through the generated `internal`
    // API, so reaching for another module from inside one makes the inference
    // self-referential. Callers need the grant and the org together anyway.
    const installation =
      typeof repo.installationId === "number"
        ? await ctx.db
            .query("orgInstallations")
            .withIndex("by_installationId", (q) =>
              q.eq("installationId", repo.installationId as number),
            )
            .unique()
        : null;

    return { ...repo, orgId: installation?.orgId ?? null };
  },
});
