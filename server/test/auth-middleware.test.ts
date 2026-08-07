import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  requireAuth,
  setGithubAuthCacheClockForTests,
  type AppEnv,
} from "../src/middleware/auth";
import {
  setOrgMemberCheckForTests,
  setOrgResolveForTests,
} from "../src/orgs/members";
import { authHeaders, installTestAuth, testAuthToken } from "./auth";

const originalFetch = globalThis.fetch;
const originalCloudApiKey = process.env.GX_CLOUD_API_KEY;
const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalClientId = process.env.GITHUB_CLIENT_ID;
const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;

function authApp() {
  const app = new Hono<AppEnv>();
  app.get("/secure", requireAuth, (c) => c.json(c.get("auth")));
  return app;
}

/**
 * A gx OAuth client, so the check-token audience check has something to ask
 * with. Without a configured client every raw GitHub bearer is refused.
 */
function installGitHubOAuthClient() {
  process.env.GITHUB_CLIENT_ID = "Iv23console";
  process.env.GITHUB_CLIENT_SECRET = "console-secret";
  delete process.env.GX_CLI_GITHUB_CLIENT_ID;
  delete process.env.GX_CLI_GITHUB_CLIENT_SECRET;
}

describe("requireAuth", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setOrgMemberCheckForTests(null);
    setOrgResolveForTests(null);
    setGithubAuthCacheClockForTests(null);
    if (originalClientId === undefined) {
      delete process.env.GITHUB_CLIENT_ID;
    } else {
      process.env.GITHUB_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.GITHUB_CLIENT_SECRET;
    } else {
      process.env.GITHUB_CLIENT_SECRET = originalClientSecret;
    }
    if (originalCloudApiKey === undefined) {
      delete process.env.GX_CLOUD_API_KEY;
    } else {
      process.env.GX_CLOUD_API_KEY = originalCloudApiKey;
    }
    if (originalConvexSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test("authorizes the configured cloud API key with explicit user and org headers", async () => {
    installTestAuth();

    const res = await authApp().request("http://localhost/secure", {
      headers: authHeaders("test-user", "test-org"),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "test-org",
      userId: "test-user",
      tokenLabel: "cloud-api-key",
    });
  });

  test("uses a local user fallback when only the org header is present", async () => {
    installTestAuth();

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: `Bearer ${testAuthToken}`,
        "X-Org-Id": "test-org",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "test-org",
      userId: "local-user",
      tokenLabel: "cloud-api-key",
    });
  });

  test("fills placeholder org for cloud API key when X-Org-Id is omitted", async () => {
    installTestAuth();

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: `Bearer ${testAuthToken}`,
        "X-User-Id": "test-user",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "00000000-0000-4000-8000-000000000001",
      userId: "test-user",
      tokenLabel: "cloud-api-key",
    });
  });

  test("allows local development without a bearer token when cloud API key is unset", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "development";

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        "X-Org-Id": "test-org",
        "X-User-Id": "test-user",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "test-org",
      userId: "test-user",
      tokenLabel: "local-dev",
    });
  });

  test("rejects missing cloud API key configuration in production", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    globalThis.fetch = (async () =>
      new Response("bad token", { status: 401 })) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: authHeaders("test-user", "test-org"),
    });
    expect(res.status).toBe(401);
  });

  test("authorizes an gx CLI session token for an org member", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.CONVEX_SITE_URL = "https://convex.example";
    setOrgMemberCheckForTests(async (orgId, githubUserId) => {
      return orgId === "test-org" && githubUserId === 12345;
    });
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://convex.example/cx/auth/cli/verify");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
      expect(JSON.parse(String(init?.body))).toEqual({ token: "gxcs_test" });
      return new Response(
        JSON.stringify({
          session_id: "session_1",
          user_id: "user_1",
          github_user_id: 12345,
          github_login: "octocat",
          machine_id: "machine_1",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gxcs_test",
        "X-Org-Id": "test-org",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "test-org",
      userId: "user_1",
      tokenLabel: "gx-cli:octocat",
      githubUserId: 12345,
      githubUserLogin: "octocat",
      sessionId: "session_1",
      machineId: "machine_1",
    });
  });

  test("resolves org for CLI session when X-Org-Id is omitted", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.CONVEX_SITE_URL = "https://convex.example";
    setOrgResolveForTests(async (githubUserId) => {
      expect(githubUserId).toBe(12345);
      return "resolved-org";
    });
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          session_id: "session_1",
          user_id: "user_1",
          github_user_id: 12345,
          github_login: "octocat",
          machine_id: "machine_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gxcs_test",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "resolved-org",
      userId: "user_1",
      tokenLabel: "gx-cli:octocat",
      githubUserId: 12345,
      githubUserLogin: "octocat",
      sessionId: "session_1",
      machineId: "machine_1",
    });
  });

  test("rejects CLI session without org membership or install", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.CONVEX_SITE_URL = "https://convex.example";
    setOrgResolveForTests(async () => null);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          session_id: "session_1",
          user_id: "user_1",
          github_user_id: 12345,
          github_login: "octocat",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gxcs_test",
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Install the gx GitHub App to continue",
    });
  });

  test("rejects CLI session spoofing another org", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.CONVEX_SITE_URL = "https://convex.example";
    setOrgMemberCheckForTests(async (orgId) => orgId === "own-org");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          session_id: "session_1",
          user_id: "user_1",
          github_user_id: 12345,
          github_login: "octocat",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gxcs_test",
        "X-Org-Id": "other-org",
      },
    });
    expect(res.status).toBe(403);
  });

  test("authorizes a GitHub access token issued for a gx OAuth client", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    installGitHubOAuthClient();
    setOrgMemberCheckForTests(async (orgId, githubUserId) => {
      return orgId === "test-org" && githubUserId === 12345;
    });
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.github.com/applications/Iv23console/token",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ access_token: "gho_test" });
      return new Response(
        JSON.stringify({
          app: { client_id: "Iv23console" },
          user: { id: 12345, login: "octocat" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gho_test",
        "X-Org-Id": "test-org",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "test-org",
      userId: "github:12345",
      tokenLabel: "github:octocat",
      githubUserId: 12345,
      githubUserLogin: "octocat",
    });
  });

  test("rejects a GitHub token issued for another application", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    installGitHubOAuthClient();
    // Membership would pass; the token never gets that far.
    setOrgMemberCheckForTests(async () => true);
    globalThis.fetch = (async (url: string | URL | Request) => {
      // The victim's token is valid at GitHub — /user would answer 200 for it,
      // which is exactly why /user is not what decides.
      if (String(url) === "https://api.github.com/user") {
        return new Response(JSON.stringify({ id: 12345, login: "octocat" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gho_some_other_apps_token",
        "X-Org-Id": "test-org",
      },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("rejects a GitHub token when no gx OAuth client is configured", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GX_CLI_GITHUB_CLIENT_ID;
    delete process.env.GX_CLI_GITHUB_CLIENT_SECRET;
    setOrgMemberCheckForTests(async () => true);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 12345, login: "octocat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gho_unverifiable",
        "X-Org-Id": "test-org",
      },
    });
    expect(res.status).toBe(401);
  });

  test("rejects GitHub token for non-member org", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    installGitHubOAuthClient();
    setOrgMemberCheckForTests(async () => false);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          app: { client_id: "Iv23console" },
          user: { id: 12345, login: "octocat" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gho_other",
        "X-Org-Id": "test-org",
      },
    });
    expect(res.status).toBe(403);
  });

  test("stops honoring a revoked GitHub token once the cache entry expires", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    installGitHubOAuthClient();
    setOrgMemberCheckForTests(async () => true);

    let now = 1_000_000;
    setGithubAuthCacheClockForTests(() => now);

    let revoked = false;
    let checkTokenCalls = 0;
    globalThis.fetch = (async () => {
      checkTokenCalls += 1;
      if (revoked) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          app: { client_id: "Iv23console" },
          user: { id: 12345, login: "octocat" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const call = () =>
      authApp().request("http://localhost/secure", {
        headers: {
          Authorization: "Bearer gho_revocable",
          "X-Org-Id": "test-org",
        },
      });

    expect((await call()).status).toBe(200);
    expect(checkTokenCalls).toBe(1);

    // Still inside the TTL: served from cache, GitHub is not asked again.
    revoked = true;
    now += 60_000;
    expect((await call()).status).toBe(200);
    expect(checkTokenCalls).toBe(1);

    // Past the 5 minute TTL the decision is re-derived, and the revoked token
    // no longer authenticates.
    now += 5 * 60 * 1000;
    expect((await call()).status).toBe(401);
    expect(checkTokenCalls).toBe(2);
  });
});
