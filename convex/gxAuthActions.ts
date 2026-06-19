"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { generateCliToken } from "./gxAuthUtils";

type GitHubUser = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

type CompleteCliAuthResult = {
  token: string;
  github_access_token?: string;
  user_id: string;
  login: string;
  session_id: Id<"gxCliSessions">;
};

async function githubFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gx-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function resolveGithubEmail(
  accessToken: string,
  githubUser: GitHubUser,
): Promise<string> {
  if (githubUser.email) {
    return githubUser.email;
  }

  try {
    const emails = await githubFetch<GitHubEmail[]>(
      "https://api.github.com/user/emails",
      accessToken,
    );
    const primary = emails.find((entry) => entry.primary && entry.verified);
    if (primary?.email) {
      return primary.email;
    }
    if (emails[0]?.email) {
      return emails[0].email;
    }
  } catch {
    // Fall through to noreply address.
  }

  return `${githubUser.id}+${githubUser.login}@users.noreply.github.com`;
}

const completeCliAuthArgs = {
  githubAccessToken: v.string(),
  machineId: v.string(),
  machineName: v.string(),
  gxVersion: v.optional(v.string()),
};

async function completeAuthWithGitHubToken(
  ctx: ActionCtx,
  args: {
    githubAccessToken: string;
    machineId: string;
    machineName: string;
    gxVersion?: string;
  },
): Promise<CompleteCliAuthResult> {
  const githubUser = await githubFetch<GitHubUser>(
    "https://api.github.com/user",
    args.githubAccessToken,
  );

  if (typeof githubUser.id !== "number" || typeof githubUser.login !== "string") {
    throw new Error("Invalid GitHub user profile");
  }

  const email = await resolveGithubEmail(args.githubAccessToken, githubUser);
  const userId = await ctx.runMutation(internal.gxAuth.ensureGithubUser, {
    githubUserId: githubUser.id,
    githubLogin: githubUser.login,
    name: githubUser.name?.trim() || githubUser.login,
    email,
    image: githubUser.avatar_url ?? undefined,
    accessToken: args.githubAccessToken,
  });

  const token = generateCliToken();
  const sessionId: Id<"gxCliSessions"> = await ctx.runMutation(
    internal.gxAuth.finishCliLogin,
    {
      userId,
      githubUserId: githubUser.id,
      githubLogin: githubUser.login,
      machineId: args.machineId,
      machineName: args.machineName,
      gxVersion: args.gxVersion,
      token,
    },
  );

  return {
    token,
    user_id: userId,
    login: githubUser.login,
    session_id: sessionId,
  };
}

export const completeCliAuth = action({
  args: completeCliAuthArgs,
  handler: async (ctx, args): Promise<CompleteCliAuthResult> => {
    return completeAuthWithGitHubToken(ctx, args);
  },
});
