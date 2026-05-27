"use node";

import type { ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";

// GitHub App permissions required by GX merge/status flows:
// - contents: read/write
// - pull_requests: read
// - checks: read
// - actions: read (actions: write is only needed for future rerun support)
export type GithubAccessResult =
  | { ok: true; defaultBranch?: string }
  | { ok: false; status: number; message: string };

export async function getGithubAccessToken(ctx: ActionCtx, userId: string) {
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

export async function verifyGithubRepoAccessWithToken(
  accessToken: string,
  fullName: string,
): Promise<GithubAccessResult> {
  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "console-app",
    },
  });

  if (response.status === 200) {
    const repo = (await response.json()) as { default_branch?: string };
    return { ok: true, defaultBranch: repo.default_branch };
  }

  if (response.status === 401) {
    return {
      ok: false,
      status: 401,
      message:
        "GitHub session expired. Sign out and sign in again to grant repository access.",
    };
  }

  if (response.status === 403 || response.status === 404) {
    return {
      ok: false,
      status: response.status,
      message: `You do not have access to ${fullName} on GitHub.`,
    };
  }

  const body = await response.text();
  return {
    ok: false,
    status: response.status,
    message: `GitHub access check failed (${response.status}): ${body}`,
  };
}

export async function verifyGithubRepoAccess(
  ctx: ActionCtx,
  userId: string,
  fullName: string,
): Promise<GithubAccessResult> {
  const accessToken = await getGithubAccessToken(ctx, userId);
  return verifyGithubRepoAccessWithToken(accessToken, fullName);
}
