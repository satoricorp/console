"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { authComponent } from "./auth";

type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
  default_branch?: string;
};

async function getGithubAccessToken(ctx: ActionCtx, userId: string) {
  const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "account",
    where: [
      { field: "userId", value: userId },
      { field: "providerId", value: "github" },
    ],
  })) as { accessToken?: string | null } | null;

  const accessToken = account?.accessToken;
  if (!accessToken) {
    throw new Error(
      "GitHub access is missing. Sign out and sign in again to grant repository access.",
    );
  }

  return accessToken;
}

export const listAvailableRepos = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in with GitHub to list repositories");
    }

    const accessToken = await getGithubAccessToken(ctx, user._id);
    const repos: GithubRepo[] = [];
    let page = 1;

    while (page <= 5) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "console-app",
          },
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to load GitHub repositories (${response.status}): ${body}`,
        );
      }

      const pageRepos = (await response.json()) as GithubRepo[];
      repos.push(...pageRepos);

      if (pageRepos.length < 100) break;
      page += 1;
    }

    const seen = new Set<string>();
    return repos
      .filter((repo) => {
        if (seen.has(repo.full_name)) return false;
        seen.add(repo.full_name);
        return true;
      })
      .map((repo) => ({
        githubId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});
