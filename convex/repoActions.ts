"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { installationIdForOwner } from "./githubAppInstall";
import { authComponent } from "./auth";
import {
  getGithubAccessToken,
  verifyGithubRepoAccess,
} from "./githubAccess";

type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
  default_branch?: string;
};

async function fetchGithubReposPage(accessToken: string, page: number) {
  return fetch(
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
}

const repoInput = v.object({
  githubId: v.number(),
  owner: v.string(),
  name: v.string(),
  fullName: v.string(),
  private: v.boolean(),
  defaultBranch: v.optional(v.string()),
});

export const listAvailableRepos = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in with GitHub to list repositories");
    }

    let accessToken = await getGithubAccessToken(ctx, user._id);
    const repos: GithubRepo[] = [];
    let page = 1;

    while (page <= 5) {
      let response = await fetchGithubReposPage(accessToken, page);

      if (response.status === 401) {
        accessToken = await getGithubAccessToken(ctx, user._id, {
          forceRefresh: true,
        });
        response = await fetchGithubReposPage(accessToken, page);
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "GitHub session expired. Sign out and sign in again to grant repository access.",
          );
        }

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

export const connectRepos = action({
  args: {
    repos: v.array(repoInput),
  },
  handler: async (ctx, { repos }) => {
    const user = await authComponent.getAuthUser(ctx);
    const accessToken = await getGithubAccessToken(ctx, user._id);
    const now = Date.now();
    const connected: string[] = [];
    const errors: string[] = [];

    for (const repo of repos) {
      const verification = await verifyGithubRepoAccess(
        ctx,
        user._id,
        repo.fullName,
      );

      if (!verification.ok) {
        errors.push(`${repo.fullName}: ${verification.message}`);
        continue;
      }

      const defaultBranch =
        verification.defaultBranch ?? repo.defaultBranch ?? "main";

      // The index namespace is per org, so a repository cannot be indexed
      // until we know which org's installation covers it. Everything else
      // about connecting still succeeds; only the indexing is deferred, and
      // the message says what to do.
      const installationId = await installationIdForOwner(accessToken, repo.owner);
      const orgId = installationId
        ? await ctx.runQuery(internal.orgs.getOrgForInstallation, { installationId })
        : null;

      const { inserted } = await ctx.runMutation(
        internal.repos.insertConnectedRepo,
        {
          userId: user._id,
          repo: { ...repo, defaultBranch },
          accessVerifiedAt: now,
          installationId: installationId ?? undefined,
        },
      );

      if (!inserted) continue;

      connected.push(repo.fullName);

      if (!orgId) {
        errors.push(
          `${repo.fullName}: connected, but not indexed yet — install the GX GitHub App on ${repo.owner} so GX Cloud can index it`,
        );
        continue;
      }

      const { shouldEnqueue, batchOffset } = await ctx.runMutation(
        internal.indexing.ensureIndexJob,
        {
          orgId,
          fullName: repo.fullName,
          githubId: repo.githubId,
          owner: repo.owner,
          name: repo.name,
          defaultBranch,
          trigger: "connect",
        },
      );

      if (shouldEnqueue) {
        await ctx.runMutation(internal.indexing.scheduleIndexRepo, {
          orgId,
          fullName: repo.fullName,
          githubId: repo.githubId,
          trigger: "connect",
          githubAccessToken: accessToken,
          batchOffset,
        });
      }
    }

    if (errors.length > 0 && connected.length === 0) {
      throw new Error(errors.join("\n"));
    }

    return { connected, errors };
  },
});
