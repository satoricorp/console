"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import {
  githubFetch,
  resolveGitHubEmail,
  type GitHubEmail,
  type GitHubProfile,
} from "./githubProfile";
import { verifyGitHubTokenAudience } from "./githubTokenAudience";

type CompleteCliAuthResult = {
  cli_session_token: string;
  cli_session_expires_at: number;
  user_id: string;
  login: string;
  avatar_url?: string;
  github_app_install_url?: string;
};

type VerifyCliSessionResult = {
  sessionId: string;
  userId: string;
  githubUserId: number;
  githubLogin: string;
  machineId: string;
  machineName: string;
  expiresAt: number;
} | null;

async function resolveGithubEmail(
  accessToken: string,
  githubUser: GitHubProfile,
): Promise<string> {
  try {
    const emails = await githubFetch<GitHubEmail[]>(
      "https://api.github.com/user/emails",
      accessToken,
    );
    return resolveGitHubEmail(githubUser, emails).email;
  } catch {
    // GitHub can hide emails; keep auth usable with the canonical noreply fallback.
  }

  return resolveGitHubEmail(githubUser).email;
}

const completeCliAuthArgs = {
  githubAccessToken: v.string(),
  machineId: v.string(),
  machineName: v.string(),
  gxVersion: v.optional(v.string()),
};

const CLI_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

function newCliSessionToken() {
  return `gxcs_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function capturePostHog(
  event: string,
  properties: Record<string, unknown> = {},
  distinctId = "dev",
) {
  const apiKey = process.env.GX_POSTHOG_KEY?.trim();
  if (!apiKey) return;

  const host = (process.env.GX_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST)
    .trim()
    .replace(/\/+$/, "");

  try {
    const response = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        properties: {
          distinct_id: distinctId,
          source: "gx-convex",
          ...properties,
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    await response.arrayBuffer().catch(() => undefined);
  } catch {
    // Telemetry must never affect auth.
  }
}

async function completeAuthWithGitHubToken(
  ctx: ActionCtx,
  args: {
    githubAccessToken: string;
    machineId: string;
    machineName: string;
    gxVersion?: string;
    source: "cli";
  },
): Promise<CompleteCliAuthResult> {
  // Audience first: this route is unauthenticated, and everything below mints
  // a 90-day gx session for whoever the token names.
  const audience = await verifyGitHubTokenAudience(args.githubAccessToken);
  if (!audience) {
    await capturePostHog("server.auth.login", {
      status: "rejected",
      auth_kind: "github",
      auth_source: args.source,
      reason: "untrusted_token_audience",
      gx_version: args.gxVersion ?? null,
    });
    throw new Error("GitHub token was not issued for gx");
  }

  const githubUser = await githubFetch<GitHubProfile>(
    "https://api.github.com/user",
    args.githubAccessToken,
  );

  if (
    (typeof githubUser.id !== "number" && typeof githubUser.id !== "string") ||
    typeof githubUser.login !== "string"
  ) {
    throw new Error("Invalid GitHub user profile");
  }

  const githubUserId =
    typeof githubUser.id === "number" ? githubUser.id : Number(githubUser.id);
  if (!Number.isSafeInteger(githubUserId)) {
    throw new Error("Invalid GitHub user id");
  }
  // The session is created for the profile, so the profile is who the verified
  // token has to belong to.
  if (githubUserId !== audience.userId) {
    throw new Error("GitHub token does not match the GitHub user profile");
  }

  const email = await resolveGithubEmail(args.githubAccessToken, githubUser);
  const userId = await ctx.runMutation(
    internal.gxAuth.ensureGithubUser,
    {
      githubUserId,
      githubLogin: githubUser.login,
      name: githubUser.name?.trim() || githubUser.login,
      email,
      avatarURL: githubUser.avatar_url ?? undefined,
      accessToken: args.githubAccessToken,
    },
  );

  const cliSessionToken = newCliSessionToken();
  const cliSessionExpiresAt = Date.now() + CLI_SESSION_TTL_MS;
  await ctx.runMutation(internal.gxAuth.createCliSession, {
    token: cliSessionToken,
    userId,
    githubUserId,
    githubLogin: githubUser.login,
    machineId: args.machineId,
    machineName: args.machineName,
    gxVersion: args.gxVersion,
    expiresAt: cliSessionExpiresAt,
  });

  const githubAppInstallURL =
    process.env.GITHUB_APP_INSTALL_URL?.trim() || undefined;
  await capturePostHog(
    "server.auth.login",
    {
      status: "success",
      auth_kind: "github",
      auth_source: args.source,
      auth_client: audience.clientLabel,
      user_id: userId,
      github_user_id: githubUserId,
      login: githubUser.login,
      gx_version: args.gxVersion ?? null,
      machine_name_set: args.machineName.trim() !== "",
      has_github_app_install_url: Boolean(githubAppInstallURL),
    },
    userId,
  );

  return {
    user_id: userId,
    login: githubUser.login,
    avatar_url: githubUser.avatar_url ?? undefined,
    cli_session_token: cliSessionToken,
    cli_session_expires_at: cliSessionExpiresAt,
    github_app_install_url: githubAppInstallURL,
  };
}

export const completeCliAuth = action({
  args: completeCliAuthArgs,
  handler: async (ctx, args): Promise<CompleteCliAuthResult> => {
    return completeAuthWithGitHubToken(ctx, { ...args, source: "cli" });
  },
});

export const verifyCliSession = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args): Promise<VerifyCliSessionResult> => {
    return ctx.runMutation(internal.gxAuth.verifyCliSession, {
      token: args.token,
    });
  },
});
