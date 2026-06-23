import { query } from "./_generated/server";
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

    const jobsByFullName = new Map<string, Doc<"repoIndexJobs">>();
    for (const fullName of repos.map((repo) => repo.fullName)) {
      const job = await ctx.db
        .query("repoIndexJobs")
        .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
        .unique();
      if (job) jobsByFullName.set(fullName, job);
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
