import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import { syncInstallationOrgsToConvex } from "../src/orgs/convex-sync";
import { describeDb } from "./db-gate";

/**
 * Convex names the namespace an index writes as gx-{orgId}-{repo}-v2, and it
 * learns installation -> org from forwarded deliveries. That keeps the mapping
 * current but cannot start it: on a fresh deploy the table is empty, no org
 * resolves, and console search returns nothing for every repository until each
 * one happens to be pushed to. This is the catch-up.
 */
describeDb("installation -> org sync", () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  let installationId: number;

  beforeAll(async () => {
    process.env.CONVEX_SITE_URL = "https://convex.test";
    process.env.TX_CLOUD_API_KEY = "test-cloud-api-key";
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({ synced: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    await runMigrations();
    const db = getSql();
    const now = Date.now();
    installationId = 8800000 + (now % 1000);
    await db`
      INSERT INTO github_app_installations (installation_id, account_login, updated_at_ms, installed_at_ms)
      VALUES (${installationId}, 'syncorg', ${now}, ${now})
      ON CONFLICT (installation_id) DO NOTHING
    `;
    await db`
      INSERT INTO orgs (installation_id, plan, created_at_ms)
      VALUES (${installationId}, 'free', ${now})
      ON CONFLICT (installation_id) DO NOTHING
    `;
  });

  afterEach(() => {
    calls.length = 0;
  });

  test("posts every installation this server knows about", async () => {
    const synced = await syncInstallationOrgsToConvex(getSql());
    expect(synced).toBeGreaterThan(0);

    const call = calls.find((c) => c.url === "https://convex.test/cx/orgs/installations");
    if (!call) throw new Error(`no sync call; saw ${calls.map((c) => c.url).join(", ")}`);

    const body = call.body as {
      installations: Array<{ installationId: number; orgId: string; accountLogin?: string }>;
    };
    const mine = body.installations.find((i) => i.installationId === installationId);
    if (!mine) throw new Error("the seeded installation was not synced");
    // A string org id, not a number: it is a UUID, and Number() on it is NaN.
    expect(typeof mine.orgId).toBe("string");
    expect(mine.orgId.length).toBeGreaterThan(0);
    expect(mine.accountLogin).toBe("syncorg");
  });

  test("is inert, and says so, when Convex is not configured", async () => {
    const saved = process.env.CONVEX_SITE_URL;
    delete process.env.CONVEX_SITE_URL;
    // Returning 0 rather than throwing keeps a misconfigured deploy serving;
    // the warning is what makes the misconfiguration findable.
    expect(await syncInstallationOrgsToConvex(getSql())).toBe(0);
    expect(calls).toHaveLength(0);
    process.env.CONVEX_SITE_URL = saved;
  });

  test("restores fetch", () => {
    globalThis.fetch = originalFetch;
    expect(typeof globalThis.fetch).toBe("function");
  });
});
