import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

let client: ConvexHttpClient | null = null;

const resolveCliTokenRef = makeFunctionReference<
  "mutation",
  { token: string },
  {
    userId: string;
    githubUserId: number;
    githubLogin: string;
    sessionId: string;
    machineId: string;
  } | null
>("gxAuth:resolveCliToken");

const ingestCliPushRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    bookmark: {
      postgresBookmarkId: string;
      latestEventId: string;
      repoFullName: string;
      branchName: string;
      title: string | null;
      revision: number;
      mergeStatus: "open" | "merged" | "closed";
      githubPrUrl: string | null;
      githubPrNumber: number | null;
      headCommitId: string | null;
      remoteHeadSha: string | null;
      updatedAt: number;
    };
  },
  null
>("gxPr:ingestCliBookmark");

const ingestDevPushRef = makeFunctionReference<
  "mutation",
  {
    devSecret: string;
    userId: string;
    sessionId?: string;
    bookmark: {
      postgresBookmarkId: string;
      latestEventId: string;
      repoFullName: string;
      branchName: string;
      title: string | null;
      revision: number;
      mergeStatus: "open" | "merged" | "closed";
      githubPrUrl: string | null;
      githubPrNumber: number | null;
      headCommitId: string | null;
      remoteHeadSha: string | null;
      updatedAt: number;
    };
  },
  null
>("gxPr:ingestDevBookmark");

function getConvexUrl(): string {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL is not set");
  }
  return url;
}

function getClient() {
  if (!client) {
    client = new ConvexHttpClient(getConvexUrl());
  }
  return client;
}

export type ResolvedCliAuth = {
  userId: string;
  githubUserId: number;
  githubLogin: string;
  sessionId: string;
  machineId: string;
};

export async function resolveCliToken(
  token: string,
): Promise<ResolvedCliAuth | null> {
  const result = await getClient().mutation(resolveCliTokenRef, { token });

  if (!result) {
    return null;
  }

  return {
    userId: result.userId,
    githubUserId: result.githubUserId,
    githubLogin: result.githubLogin,
    sessionId: result.sessionId,
    machineId: result.machineId,
  };
}

export async function ingestCliBookmark(
  token: string,
  bookmark: {
    postgresBookmarkId: string;
    latestEventId: string;
    repoFullName: string;
    branchName: string;
    title: string | null;
    revision: number;
    mergeStatus: "open" | "merged" | "closed";
    githubPrUrl: string | null;
    githubPrNumber: number | null;
    headCommitId: string | null;
    remoteHeadSha: string | null;
    updatedAt: number;
  },
): Promise<void> {
  await getClient().mutation(ingestCliPushRef, { token, bookmark });
}

export async function ingestDevBookmark(
  devSecret: string,
  userId: string,
  sessionId: string | undefined,
  bookmark: {
    postgresBookmarkId: string;
    latestEventId: string;
    repoFullName: string;
    branchName: string;
    title: string | null;
    revision: number;
    mergeStatus: "open" | "merged" | "closed";
    githubPrUrl: string | null;
    githubPrNumber: number | null;
    headCommitId: string | null;
    remoteHeadSha: string | null;
    updatedAt: number;
  },
): Promise<void> {
  await getClient().mutation(ingestDevPushRef, {
    devSecret,
    userId,
    sessionId,
    bookmark,
  });
}
