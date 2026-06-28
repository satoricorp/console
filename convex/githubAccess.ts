"use node";

import type { ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const TOKEN_REFRESH_SKEW_MS = 60_000;
const GITHUB_REAUTH_INSTRUCTION =
  "Sign out and sign in again to grant repository access.";
const GITHUB_REAUTH_MESSAGE =
  `GitHub session expired. ${GITHUB_REAUTH_INSTRUCTION}`;

// GitHub App permissions required by GX merge/status flows:
// - contents: read/write
// - pull_requests: read
// - checks: read
// - actions: read (actions: write is only needed for future rerun support)
export type GithubAccessResult =
  | { ok: true; defaultBranch?: string }
  | { ok: false; status: number; message: string };

type GithubAccount = {
  accessToken?: string | null;
  accessTokenExpiresAt?: number | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: number | null;
};

type GitHubRefreshTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function githubReauthError() {
  return new Error(GITHUB_REAUTH_MESSAGE);
}

function isExpiredRefreshTokenResponse(body: GitHubRefreshTokenResponse) {
  const text =
    `${body.error ?? ""} ${body.error_description ?? ""}`.toLowerCase();
  return (
    text.includes("refresh token") &&
    (text.includes("expired") ||
      text.includes("incorrect") ||
      text.includes("invalid") ||
      text.includes("bad"))
  );
}

async function findGithubAccount(ctx: ActionCtx, userId: string) {
  const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "account",
    where: [
      { field: "userId", value: userId },
      { field: "providerId", value: "github" },
    ],
  })) as GithubAccount | null;

  return account;
}

export function shouldRefreshGithubAccessToken(
  account: GithubAccount,
  now = Date.now(),
) {
  if (!account.accessToken) return true;
  if (!account.accessTokenExpiresAt) return false;
  return account.accessTokenExpiresAt <= now + TOKEN_REFRESH_SKEW_MS;
}

async function refreshGithubAccessToken(
  ctx: ActionCtx,
  userId: string,
  account: GithubAccount,
) {
  const refreshToken = account.refreshToken?.trim();
  if (!refreshToken) {
    throw githubReauthError();
  }

  if (
    account.refreshTokenExpiresAt &&
    account.refreshTokenExpiresAt <= Date.now()
  ) {
    throw githubReauthError();
  }

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth refresh is not configured");
  }

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "console-app",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub OAuth refresh failed: ${response.status}`);
  }

  const body = (await response.json()) as GitHubRefreshTokenResponse;
  if (body.error) {
    if (isExpiredRefreshTokenResponse(body)) {
      throw githubReauthError();
    }

    throw new Error(
      body.error_description || body.error || "GitHub OAuth refresh failed",
    );
  }
  if (!body.access_token) {
    throw new Error("GitHub OAuth refresh response missing access token");
  }

  const now = Date.now();
  const update: {
    accessToken: string;
    updatedAt: number;
    accessTokenExpiresAt?: number;
    refreshToken?: string;
    refreshTokenExpiresAt?: number;
    scope?: string;
  } = {
    accessToken: body.access_token,
    updatedAt: now,
  };

  if (typeof body.expires_in === "number") {
    update.accessTokenExpiresAt = now + body.expires_in * 1000;
  }
  if (body.refresh_token) {
    update.refreshToken = body.refresh_token;
  }
  if (typeof body.refresh_token_expires_in === "number") {
    update.refreshTokenExpiresAt = now + body.refresh_token_expires_in * 1000;
  }
  if (body.scope) {
    update.scope = body.scope;
  }

  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input: {
      model: "account",
      where: [
        { field: "userId", value: userId },
        { field: "providerId", value: "github" },
      ],
      update,
    },
  });

  return body.access_token;
}

export async function getGithubAccessToken(
  ctx: ActionCtx,
  userId: string,
  options: { forceRefresh?: boolean } = {},
) {
  const account = await findGithubAccount(ctx, userId);

  const accessToken = account?.accessToken;
  if (!account || !accessToken) {
    throw new Error(`GitHub access is missing. ${GITHUB_REAUTH_INSTRUCTION}`);
  }

  if (options.forceRefresh || shouldRefreshGithubAccessToken(account)) {
    return refreshGithubAccessToken(ctx, userId, account);
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
      message: GITHUB_REAUTH_MESSAGE,
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
  const result = await verifyGithubRepoAccessWithToken(accessToken, fullName);
  if (result.ok || result.status !== 401) return result;

  const refreshedAccessToken = await getGithubAccessToken(ctx, userId, {
    forceRefresh: true,
  });
  return verifyGithubRepoAccessWithToken(refreshedAccessToken, fullName);
}
