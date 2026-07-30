import { query } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";
import type { Doc } from "./_generated/dataModel";

type AuthUser = {
  _id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  username?: string | null;
  displayUsername?: string | null;
  createdAt?: number | null;
};

function publicUser(user: AuthUser) {
  return {
    id: user._id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
    username: user.username ?? null,
    displayUsername: user.displayUsername ?? null,
    createdAt: user.createdAt ?? null,
  };
}

function repoSummary(repo: Doc<"connectedRepos">, job: Doc<"repoIndexJobs"> | null) {
  return {
    id: repo._id,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    private: repo.private,
    defaultBranch: repo.defaultBranch ?? null,
    connectedAt: repo.connectedAt,
    accessVerifiedAt: repo.accessVerifiedAt ?? repo.connectedAt,
    indexStatus: job?.status ?? null,
  };
}

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const repos = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    // Resolve jobs via the repo's installation → by_org_fullName when we can.
    // fullName stopped being unique when jobs became per-org, so a bare
    // by_fullName unique() throws the moment two orgs index one repository —
    // taking the whole profile down rather than one row (same fix as
    // repos.getMyConnectedRepos).
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

    return {
      user: publicUser(user),
      connectedRepoCount: repos.length,
      repos: repos
        .map((repo) => repoSummary(repo, jobsByFullName.get(repo.fullName) ?? null))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
  },
});

/** Lightweight auth identity for BFF routes (TX API user id). */
export const getViewer = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      image: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return {
      id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
    };
  },
});
