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

type CompleteCliAuthResult = {
  github_access_token?: string;
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

type GitHubOAuthTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

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

function newCliSessionToken() {
  return `gxcs_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function completeAuthWithGitHubToken(
  ctx: ActionCtx,
  args: {
    githubAccessToken: string;
    machineId: string;
    machineName: string;
    gxVersion?: string;
  },
): Promise<CompleteCliAuthResult> {
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

  return {
    user_id: userId,
    login: githubUser.login,
    avatar_url: githubUser.avatar_url ?? undefined,
    cli_session_token: cliSessionToken,
    cli_session_expires_at: cliSessionExpiresAt,
    github_app_install_url:
      process.env.GITHUB_APP_INSTALL_URL?.trim() || undefined,
  };
}

export const completeCliAuth = action({
  args: completeCliAuthArgs,
  handler: async (ctx, args): Promise<CompleteCliAuthResult> => {
    return completeAuthWithGitHubToken(ctx, args);
  },
});

async function exchangeGitHubOAuthCode(
  code: string,
  redirectUri: string,
): Promise<string> {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Desktop OAuth is not configured");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "gx-desktop",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub OAuth exchange failed: ${response.status}`);
  }

  const body = (await response.json()) as GitHubOAuthTokenResponse;
  if (body.error) {
    throw new Error(body.error_description || body.error);
  }
  if (!body.access_token) {
    throw new Error("GitHub OAuth response missing access token");
  }
  return body.access_token;
}

export const createDesktopOAuthTicketFromCode = action({
  args: {
    code: v.string(),
    state: v.string(),
    redirectUri: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ticket: string; expires_at: number }> => {
    const githubAccessToken = await exchangeGitHubOAuthCode(
      args.code,
      args.redirectUri,
    );
    const ticket = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    await ctx.runMutation(internal.gxAuth.createDesktopOAuthTicket, {
      ticket,
      state: args.state,
      githubAccessToken,
      expiresAt,
    });
    return { ticket, expires_at: expiresAt };
  },
});

export const completeDesktopOAuth = action({
  args: {
    ticket: v.string(),
    state: v.string(),
    machineId: v.string(),
    machineName: v.string(),
    gxVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CompleteCliAuthResult> => {
    const ticket = await ctx.runMutation(
      internal.gxAuth.consumeDesktopOAuthTicket,
      {
        ticket: args.ticket,
        state: args.state,
      },
    );
    if (!ticket?.githubAccessToken) {
      throw new Error("Desktop OAuth ticket is invalid or expired");
    }

    const result = await completeAuthWithGitHubToken(ctx, {
      githubAccessToken: ticket.githubAccessToken,
      machineId: args.machineId,
      machineName: args.machineName,
      gxVersion: args.gxVersion,
    });
    return {
      ...result,
      github_access_token: ticket.githubAccessToken,
    };
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
