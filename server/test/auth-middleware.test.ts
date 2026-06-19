import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireAuth, type AppEnv } from "../src/middleware/auth";
import { authHeaders, installTestAuth, testAuthToken } from "./auth";

const originalFetch = globalThis.fetch;
const originalCloudApiKey = process.env.GX_CLOUD_API_KEY;
const originalNodeEnv = process.env.NODE_ENV;

function authApp() {
  const app = new Hono<AppEnv>();
  app.get("/secure", requireAuth, (c) => c.json(c.get("auth")));
  return app;
}

describe("requireAuth", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCloudApiKey === undefined) {
      delete process.env.GX_CLOUD_API_KEY;
    } else {
      process.env.GX_CLOUD_API_KEY = originalCloudApiKey;
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
    globalThis.fetch = (async () => new Response("bad token", { status: 401 })) as unknown as typeof fetch;

    const res = await authApp().request("http://localhost/secure", {
      headers: authHeaders("test-user", "test-org"),
    });
    expect(res.status).toBe(401);
  });

  test("authorizes a GitHub access token", async () => {
    delete process.env.GX_CLOUD_API_KEY;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/user");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gho_test");
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
    });
  });
});
