import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireAuth, type AppEnv } from "../src/middleware/auth";
import {
  setOrgMemberCheckForTests,
  setOrgResolveForTests,
} from "../src/orgs/members";
import { authHeaders, installTestAuth, testAuthToken } from "./auth";

const originalFetch = globalThis.fetch;
const originalCloudApiKey = process.env.TX_CLOUD_API_KEY;
const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
const originalNodeEnv = process.env.NODE_ENV;

function authApp() {
  const app = new Hono<AppEnv>();
  app.get("/secure", requireAuth, (c) => c.json(c.get("auth")));
  return app;
}

describe("requireAuth", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setOrgMemberCheckForTests(null);
    setOrgResolveForTests(null);
    if (originalCloudApiKey === undefined) {
      delete process.env.TX_CLOUD_API_KEY;
    } else {
      process.env.TX_CLOUD_API_KEY = originalCloudApiKey;
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
    delete process.env.TX_CLOUD_API_KEY;
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
    delete process.env.TX_CLOUD_API_KEY;
    process.env.NODE_ENV = "production";
    globalThis.fetch = (async () =>
      new Response("bad token", { status: 401 })) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: authHeaders("test-user", "test-org"),
    });
    expect(res.status).toBe(401);
  });

  test("authorizes a TX CLI session token for an org member", async () => {
    delete process.env.TX_CLOUD_API_KEY;
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
      tokenLabel: "tx-cli:octocat",
      githubUserId: 12345,
      githubUserLogin: "octocat",
      sessionId: "session_1",
      machineId: "machine_1",
    });
  });

  test("resolves org for CLI session when X-Org-Id is omitted", async () => {
    delete process.env.TX_CLOUD_API_KEY;
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
      tokenLabel: "tx-cli:octocat",
      githubUserId: 12345,
      githubUserLogin: "octocat",
      sessionId: "session_1",
      machineId: "machine_1",
    });
  });

  test("rejects CLI session without org membership or install", async () => {
    delete process.env.TX_CLOUD_API_KEY;
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
      error: "Install the TX GitHub App to continue",
    });
  });

  test("rejects CLI session spoofing another org", async () => {
    delete process.env.TX_CLOUD_API_KEY;
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

  test("authorizes a GitHub access token for an org member", async () => {
    delete process.env.TX_CLOUD_API_KEY;
    setOrgMemberCheckForTests(async (orgId, githubUserId) => {
      return orgId === "test-org" && githubUserId === 12345;
    });
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/user");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer gho_test",
      );
      return new Response(JSON.stringify({ id: 12345, login: "octocat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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

  test("rejects GitHub token for non-member org", async () => {
    delete process.env.TX_CLOUD_API_KEY;
    setOrgMemberCheckForTests(async () => false);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 12345, login: "octocat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: {
        Authorization: "Bearer gho_other",
        "X-Org-Id": "test-org",
      },
    });
    expect(res.status).toBe(403);
  });
});
