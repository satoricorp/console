import type { AuthContext } from "../types";

export function devAuthContext(token: string): AuthContext | null {
  const devKey = process.env.GX_CLOUD_API_KEY?.trim();
  const userId = process.env.GX_DEV_USER_ID?.trim();
  if (!devKey || !userId || token !== devKey) {
    return null;
  }

  const githubUserIdRaw = process.env.GX_DEV_GITHUB_USER_ID?.trim();
  const githubUserId = githubUserIdRaw ? Number(githubUserIdRaw) : 0;

  return {
    userId,
    githubUserId: Number.isFinite(githubUserId) ? githubUserId : 0,
    githubUserLogin: process.env.GX_DEV_GITHUB_LOGIN?.trim() || "dev",
    sessionId: "dev",
    machineId: "dev",
  };
}
