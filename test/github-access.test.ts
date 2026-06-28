import { afterEach, describe, expect, test } from "bun:test";
import {
  getGithubAccessToken,
  shouldRefreshGithubAccessToken,
} from "../convex/githubAccess";

const originalFetch = globalThis.fetch;
const originalClientId = process.env.GITHUB_CLIENT_ID;
const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("GITHUB_CLIENT_ID", originalClientId);
  restoreEnv("GITHUB_CLIENT_SECRET", originalClientSecret);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function mockCtx(account: Record<string, unknown>) {
  const mutations: unknown[] = [];
  return {
    mutations,
    ctx: {
      runQuery: async () => account,
      runMutation: async (_fn: unknown, args: unknown) => {
        mutations.push(args);
      },
    },
  };
}

describe("shouldRefreshGithubAccessToken", () => {
  test("keeps non-expiring tokens", () => {
    expect(shouldRefreshGithubAccessToken({ accessToken: "ghu_live" }, 1000)).toBe(
      false,
    );
  });

  test("refreshes tokens inside the skew window", () => {
    expect(
      shouldRefreshGithubAccessToken(
        { accessToken: "ghu_old", accessTokenExpiresAt: 61_000 },
        1_000,
      ),
    ).toBe(true);
  });
});

describe("getGithubAccessToken", () => {
  test("returns a valid stored token without refreshing", async () => {
    const { ctx, mutations } = mockCtx({
      accessToken: "ghu_live",
      accessTokenExpiresAt: Date.now() + 10 * 60 * 1000,
      refreshToken: "ghr_refresh",
    });

    globalThis.fetch = (async () => {
      throw new Error("unexpected refresh");
    }) as unknown as typeof fetch;

    await expect(getGithubAccessToken(ctx as never, "user_123")).resolves.toBe(
      "ghu_live",
    );
    expect(mutations).toEqual([]);
  });

  test("refreshes expired GitHub tokens and persists the replacement", async () => {
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret";
    const { ctx, mutations } = mockCtx({
      accessToken: "ghu_old",
      accessTokenExpiresAt: Date.now() - 1,
      refreshToken: "ghr_refresh",
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://github.com/login/oauth/access_token");
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      return Response.json({
        access_token: "ghu_new",
        expires_in: 28_800,
        refresh_token: "ghr_new",
        refresh_token_expires_in: 15_768_000,
        scope: "repo",
      });
    }) as typeof fetch;

    await expect(getGithubAccessToken(ctx as never, "user_123")).resolves.toBe(
      "ghu_new",
    );
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      input: {
        model: "account",
        where: [
          { field: "userId", value: "user_123" },
          { field: "providerId", value: "github" },
        ],
        update: {
          accessToken: "ghu_new",
          refreshToken: "ghr_new",
          scope: "repo",
        },
      },
    });
  });

  test("normalizes expired refresh token responses to a re-auth message", async () => {
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret";
    const { ctx, mutations } = mockCtx({
      accessToken: "ghu_old",
      accessTokenExpiresAt: Date.now() - 1,
      refreshToken: "ghr_expired",
    });

    globalThis.fetch = (async () =>
      Response.json({
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      })) as typeof fetch;

    await expect(getGithubAccessToken(ctx as never, "user_123")).rejects.toThrow(
      "GitHub session expired. Sign out and sign in again to grant repository access.",
    );
    expect(mutations).toEqual([]);
  });
});
