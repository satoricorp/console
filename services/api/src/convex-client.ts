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
  { token: string; payload: unknown },
  null
>("gxPr:ingestCliPush");

const ingestDevPushRef = makeFunctionReference<
  "mutation",
  {
    devSecret: string;
    userId: string;
    sessionId?: string;
    payload: unknown;
  },
  null
>("gxPr:ingestDevPush");

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

export async function ingestCliPush(
  token: string,
  payload: unknown,
): Promise<void> {
  await getClient().mutation(ingestCliPushRef, { token, payload });
}

export async function ingestDevPush(
  devSecret: string,
  userId: string,
  sessionId: string | undefined,
  payload: unknown,
): Promise<void> {
  await getClient().mutation(ingestDevPushRef, {
    devSecret,
    userId,
    sessionId,
    payload,
  });
}
