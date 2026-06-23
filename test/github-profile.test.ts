import { afterEach, describe, expect, test } from "bun:test";
import {
  getBetterAuthGitHubUserInfo,
  resolveGitHubEmail,
} from "../convex/githubProfile";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveGitHubEmail", () => {
  test("prefers the primary verified private email over the profile email", () => {
    expect(
      resolveGitHubEmail(
        { id: 123, login: "octo", email: "octo@example.com" },
        [{ email: "primary@example.com", primary: true, verified: true }],
      ),
    ).toEqual({ email: "primary@example.com", emailVerified: true });
  });

  test("prefers the primary verified private email", () => {
    expect(
      resolveGitHubEmail(
        { id: 123, login: "octo", email: null },
        [
          { email: "secondary@example.com", primary: false, verified: true },
          { email: "primary@example.com", primary: true, verified: true },
        ],
      ),
    ).toEqual({ email: "primary@example.com", emailVerified: true });
  });

  test("uses the profile email when the emails endpoint has no usable address", () => {
    expect(
      resolveGitHubEmail(
        { id: 123, login: "octo", email: "octo@example.com" },
        [],
      ),
    ).toEqual({ email: "octo@example.com", emailVerified: false });
  });

  test("falls back to canonical GitHub noreply when no email is available", () => {
    expect(resolveGitHubEmail({ id: 123, login: "octo", email: null })).toEqual(
      {
        email: "123+octo@users.noreply.github.com",
        emailVerified: false,
      },
    );
  });
});

describe("getBetterAuthGitHubUserInfo", () => {
  test("returns Better Auth user data even when the emails endpoint is unavailable", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.github.com/user") {
        return Response.json({
          id: 123,
          login: "octo",
          name: "",
          avatar_url: "https://avatars.githubusercontent.com/u/123",
          email: null,
        });
      }
      if (url === "https://api.github.com/user/emails") {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await expect(
      getBetterAuthGitHubUserInfo({ accessToken: "token" }),
    ).resolves.toEqual({
      user: {
        id: "123",
        name: "octo",
        email: "123+octo@users.noreply.github.com",
        image: "https://avatars.githubusercontent.com/u/123",
        emailVerified: false,
        username: "octo",
        displayUsername: "octo",
      },
      data: {
        id: 123,
        login: "octo",
        name: "",
        avatar_url: "https://avatars.githubusercontent.com/u/123",
        email: "123+octo@users.noreply.github.com",
      },
    });
  });
});
