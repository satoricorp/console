import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { closeDatabase, getSql, runMigrations } from "../src/db";
import { BASE_TRIAL_DAYS, MS_PER_DAY } from "../src/metering/quota";
import { authHeaders, installTestAuth } from "./auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const chatPayload = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
};

describeDb("OpenAI proxy quota gate", () => {
  let trialOrgId: string;
  let expiredOrgId: string;
  let paidOrgId: string;

  beforeAll(async () => {
    installTestAuth();
    await runMigrations();

    const db = getSql();
    const now = Date.now();
    const expired = now - (BASE_TRIAL_DAYS + 1) * MS_PER_DAY;

    const [trialOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${now}) RETURNING id
    `;
    trialOrgId = trialOrg.id;

    const [expiredOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${expired}) RETURNING id
    `;
    expiredOrgId = expiredOrg.id;

    const [paidOrg] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('pro', ${expired}) RETURNING id
    `;
    paidOrgId = paidOrg.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("past-trial free org gets 402 with upgrade info", async () => {
    const response = await app.request("/gx/openai/chat-completions", {
      method: "POST",
      headers: {
        ...authHeaders("local-user", expiredOrgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatPayload),
    });
    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("payment_required");
    expect(body.reason).toBe("trial_expired");
    expect(typeof body.message).toBe("string");
    expect("upgrade_url" in body).toBe(true);
  });

  test("past-trial free org gets 402 on responses route too", async () => {
    const response = await app.request("/gx/openai/responses", {
      method: "POST",
      headers: {
        ...authHeaders("local-user", expiredOrgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5", input: "hi" }),
    });
    expect(response.status).toBe(402);
  });

  test("in-trial free org passes the gate", async () => {
    const response = await app.request("/gx/openai/chat-completions", {
      method: "POST",
      headers: {
        ...authHeaders("local-user", trialOrgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatPayload),
    });
    // Past the quota gate; without an upstream OpenAI key configured the
    // route reports 503, never 402.
    expect(response.status).not.toBe(402);
  });

  test("paid org passes the gate regardless of age", async () => {
    const response = await app.request("/gx/openai/chat-completions", {
      method: "POST",
      headers: {
        ...authHeaders("local-user", paidOrgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatPayload),
    });
    expect(response.status).not.toBe(402);
  });

  test("entitlement service authentication failure returns 503", async () => {
    const originalFetch = globalThis.fetch;
    const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
    process.env.CONVEX_SITE_URL = "https://convex.test";
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

    try {
      const response = await app.request("/gx/openai/chat-completions", {
        method: "POST",
        headers: {
          ...authHeaders("convex-user-openai-auth", expiredOrgId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chatPayload),
      });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("entitlement_unavailable");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalConvexSiteUrl === undefined) {
        delete process.env.CONVEX_SITE_URL;
      } else {
        process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
      }
    }
  });
});
