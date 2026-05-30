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

type ConvexBookmarkPayload = {
  postgresBookmarkId: string;
  latestEventId: string;
  repoFullName: string;
  branchName: string;
  title: string | null;
  revision: number;
  mergeStatus: "open" | "merged" | "closed";
  updatedAt: number;
  githubPrUrl?: string;
  githubPrNumber?: number;
  headCommitId?: string;
  remoteHeadSha?: string;
};

const ingestCliPushRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    bookmark: ConvexBookmarkPayload;
  },
  null
>("gxPr:ingestCliBookmark");

const ingestDevPushRef = makeFunctionReference<
  "mutation",
  {
    devSecret: string;
    userId: string;
    sessionId?: string;
    bookmark: ConvexBookmarkPayload;
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

type BookmarkPayload = {
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

function compactBookmark(bookmark: BookmarkPayload): ConvexBookmarkPayload {
  return {
    postgresBookmarkId: bookmark.postgresBookmarkId,
    latestEventId: bookmark.latestEventId,
    repoFullName: bookmark.repoFullName,
    branchName: bookmark.branchName,
    title: bookmark.title,
    revision: bookmark.revision,
    mergeStatus: bookmark.mergeStatus,
    updatedAt: bookmark.updatedAt,
    ...(bookmark.githubPrUrl ? { githubPrUrl: bookmark.githubPrUrl } : {}),
    ...(bookmark.githubPrNumber !== null
      ? { githubPrNumber: bookmark.githubPrNumber }
      : {}),
    ...(bookmark.headCommitId ? { headCommitId: bookmark.headCommitId } : {}),
    ...(bookmark.remoteHeadSha ? { remoteHeadSha: bookmark.remoteHeadSha } : {}),
  };
}

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
  bookmark: BookmarkPayload,
): Promise<void> {
  await getClient().mutation(ingestCliPushRef, {
    token,
    bookmark: compactBookmark(bookmark),
  });
}

export async function ingestDevBookmark(
  devSecret: string,
  userId: string,
  sessionId: string | undefined,
  bookmark: BookmarkPayload,
): Promise<void> {
  await getClient().mutation(ingestDevPushRef, {
    devSecret,
    userId,
    sessionId,
    bookmark: compactBookmark(bookmark),
  });
}
