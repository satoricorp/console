import { afterEach, describe, expect, test } from "bun:test";
import { verifyGitHubTokenAudience } from "../src/github/oauth";

const originalFetch = globalThis.fetch;
const originalEnv = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  GX_CLI_GITHUB_CLIENT_ID: process.env.GX_CLI_GITHUB_CLIENT_ID,
  GX_CLI_GITHUB_CLIENT_SECRET: process.env.GX_CLI_GITHUB_CLIENT_SECRET,
};

function restoreEnv(key: keyof typeof originalEnv) {
  const value = originalEnv[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function checkTokenResponse(clientId: string, user: { id: number; login: string }) {
  return new Response(JSON.stringify({ app: { client_id: clientId }, user }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** GitHub's answer for a token that belongs to some other application. */
function notThisApp() {
  return new Response(JSON.stringify({ message: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

describe("verifyGitHubTokenAudience", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv("GITHUB_CLIENT_ID");
    restoreEnv("GITHUB_CLIENT_SECRET");
    restoreEnv("GX_CLI_GITHUB_CLIENT_ID");
    restoreEnv("GX_CLI_GITHUB_CLIENT_SECRET");
  });

  test("accepts a token issued for the console OAuth client", async () => {
    process.env.GITHUB_CLIENT_ID = "Iv23console";
    process.env.GITHUB_CLIENT_SECRET = "console-secret";
    delete process.env.GX_CLI_GITHUB_CLIENT_ID;
    delete process.env.GX_CLI_GITHUB_CLIENT_SECRET;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://api.github.com/applications/Iv23console/token",
      );
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from("Iv23console:console-secret").toString("base64")}`,
      );
      expect(JSON.parse(String(init?.body))).toEqual({ access_token: "gho_user" });
      return checkTokenResponse("Iv23console", { id: 12345, login: "octocat" });
    }) as typeof fetch;

    await expect(verifyGitHubTokenAudience("gho_user")).resolves.toEqual({
      clientId: "Iv23console",
      clientLabel: "console",
      userId: 12345,
      userLogin: "octocat",
    });
  });

  test("accepts a CLI device-flow token, which the console client does not know", async () => {
    process.env.GITHUB_CLIENT_ID = "Iv23console";
    process.env.GITHUB_CLIENT_SECRET = "console-secret";
    process.env.GX_CLI_GITHUB_CLIENT_ID = "Iv23cli";
    process.env.GX_CLI_GITHUB_CLIENT_SECRET = "cli-secret";

    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      if (url.includes("Iv23cli")) {
        return checkTokenResponse("Iv23cli", { id: 777, login: "dev" });
      }
      return notThisApp();
    }) as typeof fetch;

    await expect(verifyGitHubTokenAudience("ghu_cli")).resolves.toEqual({
      clientId: "Iv23cli",
      clientLabel: "cli",
      userId: 777,
      userLogin: "dev",
    });
    expect(asked).toHaveLength(2);
  });

  test("rejects a token issued for somebody else's application", async () => {
    process.env.GITHUB_CLIENT_ID = "Iv23console";
    process.env.GITHUB_CLIENT_SECRET = "console-secret";
    process.env.GX_CLI_GITHUB_CLIENT_ID = "Iv23cli";
    process.env.GX_CLI_GITHUB_CLIENT_SECRET = "cli-secret";

    globalThis.fetch = (async () => notThisApp()) as unknown as typeof fetch;

    await expect(
      verifyGitHubTokenAudience("gho_attacker_app_token"),
    ).resolves.toBeNull();
  });

  test("rejects every token when no client credentials are configured", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GX_CLI_GITHUB_CLIENT_ID;
    delete process.env.GX_CLI_GITHUB_CLIENT_SECRET;

    globalThis.fetch = (async () => {
      throw new Error("must not ask GitHub with no credentials to ask with");
    }) as unknown as typeof fetch;

    await expect(verifyGitHubTokenAudience("gho_anything")).resolves.toBeNull();
  });

  test("rejects an answer that names a different client than the one asked", async () => {
    process.env.GITHUB_CLIENT_ID = "Iv23console";
    process.env.GITHUB_CLIENT_SECRET = "console-secret";
    delete process.env.GX_CLI_GITHUB_CLIENT_ID;
    delete process.env.GX_CLI_GITHUB_CLIENT_SECRET;

    globalThis.fetch = (async () =>
      checkTokenResponse("Iv23somebodyelse", {
        id: 12345,
        login: "octocat",
      })) as unknown as typeof fetch;

    await expect(verifyGitHubTokenAudience("gho_user")).resolves.toBeNull();
  });

  test("rejects when GitHub refuses our own client credentials", async () => {
    process.env.GITHUB_CLIENT_ID = "Iv23console";
    process.env.GITHUB_CLIENT_SECRET = "stale-secret";
    delete process.env.GX_CLI_GITHUB_CLIENT_ID;
    delete process.env.GX_CLI_GITHUB_CLIENT_SECRET;

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(verifyGitHubTokenAudience("gho_user")).resolves.toBeNull();
  });
});
