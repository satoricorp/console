"use node";

import { action } from "./_generated/server";
import { authComponent } from "./auth";
import { getGithubAccessToken } from "./githubAccess";

type GithubInstallation = {
  id: number;
  app_id: number;
  app_slug?: string;
  account?: { login?: string };
};

type GithubInstallationsResponse = {
  total_count?: number;
  installations?: GithubInstallation[];
};

const DEFAULT_INSTALL_URL = "https://github.com/apps/gx-agentic-code-review";

function githubAppInstallUrl() {
  return process.env.GITHUB_APP_INSTALL_URL?.trim() || DEFAULT_INSTALL_URL;
}

function githubAppId() {
  const raw = process.env.GITHUB_APP_ID?.trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

async function fetchUserInstallations(accessToken: string) {
  const response = await fetch("https://api.github.com/user/installations", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "console-app",
    },
  });
  return response;
}

export const getGithubAppInstallStatus = action({
  args: {},
  handler: async (ctx) => {
    const installUrl = githubAppInstallUrl();
    const appId = githubAppId();

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return { installUrl, installed: false as const, checked: false as const };
    }

    if (appId === null) {
      return { installUrl, installed: false as const, checked: false as const };
    }

    let accessToken = await getGithubAccessToken(ctx, user._id);
    let response = await fetchUserInstallations(accessToken);

    if (response.status === 401) {
      accessToken = await getGithubAccessToken(ctx, user._id, {
        forceRefresh: true,
      });
      response = await fetchUserInstallations(accessToken);
    }

    if (!response.ok) {
      return { installUrl, installed: false as const, checked: false as const };
    }

    const body = (await response.json()) as GithubInstallationsResponse;
    const installed = (body.installations ?? []).some(
      (installation) => installation.app_id === appId,
    );

    return { installUrl, installed, checked: true as const };
  },
});
