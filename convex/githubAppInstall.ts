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

const DEFAULT_INSTALL_URL = "https://github.com/apps/satoricorp-gx";

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

/**
 * The gx App installation covering a repository owner, as seen by this user.
 *
 * The connect path knows a user and a repository but never sees a webhook, so
 * this is how it reaches the same installation id the webhook path carries —
 * and through it, the org that owns the index namespace. Matching on the
 * account login matters: a user commonly has both a personal installation and
 * one on their company org, and picking the wrong one would file the
 * repository under the wrong org.
 *
 * Only an account-login match counts. Falling back to "their only installation"
 * was worse than returning nothing: a user with one installation on their
 * personal account who connects an org repository would have it filed under the
 * personal org and written to gx-{personalOrg}-{owner}-{repo}-v2 — the exact
 * cross-org namespace mix-up orgId exists to prevent, and silent, because the
 * index looks healthy from every angle except the org it landed in. Returning
 * null instead leaves the repository unindexed until the App is installed on
 * the owner, which the installation webhook then repairs
 * (indexingActions.handleGithubWebhook).
 */
export async function installationIdForOwner(
  accessToken: string,
  owner: string,
): Promise<number | null> {
  const appId = githubAppId();
  if (appId === null) return null;

  const response = await fetchUserInstallations(accessToken);
  if (!response.ok) return null;

  const body = (await response.json()) as GithubInstallationsResponse;
  const ours = (body.installations ?? []).filter(
    (installation) => installation.app_id === appId,
  );
  const wanted = owner.trim().toLowerCase();
  const match = ours.find(
    (installation) =>
      (installation as { account?: { login?: string } }).account?.login
        ?.trim()
        .toLowerCase() === wanted,
  );
  const id = (match as { id?: number } | undefined)?.id;
  return typeof id === "number" ? id : null;
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
