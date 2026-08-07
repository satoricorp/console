import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { verifyGitHubTokenAudience } from "../convex/githubTokenAudience";

const originalFetch = globalThis.fetch;
const originalEnv = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  GX_LEGACY_GITHUB_CLIENT_ID: process.env.GX_LEGACY_GITHUB_CLIENT_ID,
  GX_LEGACY_GITHUB_CLIENT_SECRET: process.env.GX_LEGACY_GITHUB_CLIENT_SECRET,
};

function restoreEnv(key: keyof typeof originalEnv) {
  const value = originalEnv[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function installGxClients() {
  process.env.GITHUB_CLIENT_ID = "Iv23gx";
  process.env.GITHUB_CLIENT_SECRET = "gx-secret";
  process.env.GX_LEGACY_GITHUB_CLIENT_ID = "Iv23old";
  process.env.GX_LEGACY_GITHUB_CLIENT_SECRET = "legacy-secret";
}

describe("verifyGitHubTokenAudience", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("GITHUB_CLIENT_ID");
    restoreEnv("GITHUB_CLIENT_SECRET");
    restoreEnv("GX_LEGACY_GITHUB_CLIENT_ID");
    restoreEnv("GX_LEGACY_GITHUB_CLIENT_SECRET");
  });

  test("accepts a token the gx device flow issued", async () => {
    installGxClients();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("Iv23gx")) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
        });
      }
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Basic ${btoa("Iv23gx:gx-secret")}`);
      expect(JSON.parse(String(init?.body))).toEqual({ access_token: "ghu_cli" });
      return Response.json({
        app: { client_id: "Iv23gx" },
        user: { id: 4242, login: "octocat" },
      });
    }) as typeof fetch;

    await expect(verifyGitHubTokenAudience("ghu_cli")).resolves.toEqual({
      clientId: "Iv23gx",
      clientLabel: "gx",
      userId: 4242,
      userLogin: "octocat",
    });
  });

  test("still accepts a CLI binary built before the clients were consolidated", async () => {
    installGxClients();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (!String(input).includes("Iv23old")) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
        });
      }
      return Response.json({
        app: { client_id: "Iv23old" },
        user: { id: 4242, login: "octocat" },
      });
    }) as typeof fetch;

    await expect(verifyGitHubTokenAudience("ghu_old_binary")).resolves.toEqual({
      clientId: "Iv23old",
      clientLabel: "legacy",
      userId: 4242,
      userLogin: "octocat",
    });
  });

  test("refuses the retired client once its credentials are removed", async () => {
    installGxClients();
    delete process.env.GX_LEGACY_GITHUB_CLIENT_ID;
    delete process.env.GX_LEGACY_GITHUB_CLIENT_SECRET;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Only the canonical client is asked now, and the old token is not its.
      expect(String(input)).toContain("Iv23gx");
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    }) as typeof fetch;

    await expect(
      verifyGitHubTokenAudience("ghu_old_binary"),
    ).resolves.toBeNull();
  });

  test("rejects a valid GitHub token issued for a different application", async () => {
    installGxClients();
    // The token is real and api.github.com/user would happily describe its
    // owner — it simply was not minted for gx, so it buys no gx session.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === "https://api.github.com/user") {
        return Response.json({ id: 4242, login: "octocat" });
      }
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    }) as typeof fetch;

    await expect(
      verifyGitHubTokenAudience("gho_third_party_app_token"),
    ).resolves.toBeNull();
  });

  test("rejects every token when no client credentials are configured", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GX_LEGACY_GITHUB_CLIENT_ID;
    delete process.env.GX_LEGACY_GITHUB_CLIENT_SECRET;
    globalThis.fetch = (async () => {
      throw new Error("must not ask GitHub with no credentials to ask with");
    }) as unknown as typeof fetch;

    await expect(verifyGitHubTokenAudience("ghu_anything")).resolves.toBeNull();
  });
});

describe("completeAuthWithGitHubToken wiring", () => {
  const source = readFileSync(
    new URL("../convex/gxAuthActions.ts", import.meta.url),
    "utf8",
  );

  test("verifies the token audience before minting a CLI session", () => {
    const body = source.slice(
      source.indexOf("async function completeAuthWithGitHubToken"),
    );
    const audienceCheck = body.indexOf("verifyGitHubTokenAudience(");
    const sessionMint = body.indexOf("newCliSessionToken()");
    // The trailing comma keeps this off the /user/emails read.
    const profileFetch = body.indexOf('"https://api.github.com/user",');

    expect(audienceCheck).toBeGreaterThan(-1);
    expect(profileFetch).toBeGreaterThan(-1);
    expect(sessionMint).toBeGreaterThan(-1);
    // The route is unauthenticated, so nothing that trusts the token — not the
    // profile read, not the session — may run ahead of the audience check.
    expect(audienceCheck).toBeLessThan(profileFetch);
    expect(audienceCheck).toBeLessThan(sessionMint);
  });

  test("binds the session to the GitHub user the verified token belongs to", () => {
    expect(source).toContain("githubUserId !== audience.userId");
  });
});
