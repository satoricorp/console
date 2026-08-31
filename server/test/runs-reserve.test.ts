import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { createMockProvider } from "../src/llm/provider";
import { prSummaryRunKey } from "../src/metering/quota";
import { generateSummary } from "../src/summary/generate";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

/**
 * A stand-in for convex /cx/runs/reserve that keeps the same ledger semantics:
 * a subscriber always passes, a free user spends runs up to the limit, and a
 * repeated run key never spends twice. What the server does with the answer
 * is the contract under test; the ledger itself lives in convex/runs.ts.
 */
function fakeConvex(options: { limit: number; subscribed?: boolean }) {
  const seen = new Set<string>();
  const calls: Array<{ user_id: string; kind: string; run_key: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.endsWith("/cx/runs/reserve")) {
      return new Response("not found", { status: 404 });
    }
    const body = JSON.parse(String(init?.body)) as {
      user_id: string;
      kind: string;
      run_key: string;
    };
    calls.push(body);
    const key = `${body.user_id}:${body.run_key}`;
    const already = seen.has(key);
    const usedBefore = [...seen].filter((k) => k.startsWith(`${body.user_id}:`))
      .length;
    const payload = (allowed: boolean, reason: string, used: number) => ({
      allowed,
      reason,
      subscribed: Boolean(options.subscribed),
      used,
      limit: options.limit,
      remaining: Math.max(options.limit - used, 0),
      checkout_url: "https://gx.run/checkout",
    });
    if (options.subscribed) {
      seen.add(key);
      return Response.json(payload(true, "subscribed", usedBefore));
    }
    if (already) {
      return Response.json(payload(true, "already_reserved", usedBefore));
    }
    if (usedBefore >= options.limit) {
      return Response.json(
        payload(false, "free_runs_exhausted", options.limit),
      );
    }
    seen.add(key);
    return Response.json(payload(true, "free_run", usedBefore + 1));
  };
  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

const chatPayload = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
};

describeDb("free-run reservation", () => {
  let orgId: string;
  const originalFetch = globalThis.fetch;
  const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;

  beforeAll(async () => {
    installTestAuth();
    process.env.CONVEX_SITE_URL = "https://convex.test";
    await runMigrations();
    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms) VALUES ('free', ${Date.now()}) RETURNING id
    `;
    orgId = org.id;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    if (originalConvexSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
    }
  });

  function reserve(userId: string, runKey: string) {
    return app.request("/v1/runs/reserve", {
      method: "POST",
      headers: {
        ...authHeaders(userId, orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "review", run_key: runKey }),
    });
  }

  test("free runs are spent one per run key, then refused with the checkout URL", async () => {
    const convex = fakeConvex({ limit: 2 });
    globalThis.fetch = convex.fetch;
    const userId = `convex-user-${crypto.randomUUID()}`;

    const first = await reserve(userId, "run-1");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      allowed: true,
      reason: "free_run",
      used: 1,
      limit: 2,
      remaining: 1,
    });

    // Same key again: the reservation is idempotent, nothing is spent.
    const again = await reserve(userId, "run-1");
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      reason: "already_reserved",
      used: 1,
    });

    const second = await reserve(userId, "run-2");
    expect(second.status).toBe(200);

    const third = await reserve(userId, "run-3");
    expect(third.status).toBe(402);
    const body = (await third.json()) as Record<string, unknown>;
    expect(body.error).toBe("payment_required");
    expect(body.reason).toBe("free_runs_exhausted");
    expect(body.checkout_url).toBe("https://gx.run/checkout");
    expect(body.upgrade_url).toBe("https://gx.run/checkout");
    expect(String(body.message)).toContain("https://gx.run/checkout");

    expect(convex.calls.map((c) => c.kind)).toEqual([
      "review",
      "review",
      "review",
      "review",
    ]);
    expect(convex.calls.every((c) => c.user_id === userId)).toBe(true);
  });

  test("a subscriber is never refused", async () => {
    const convex = fakeConvex({ limit: 1, subscribed: true });
    globalThis.fetch = convex.fetch;
    const userId = `convex-user-${crypto.randomUUID()}`;

    for (const key of ["a", "b", "c"]) {
      const response = await reserve(userId, key);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        allowed: true,
        reason: "subscribed",
      });
    }
  });

  test("model proxy calls reserve under X-GX-Run, so one review costs one run", async () => {
    const convex = fakeConvex({ limit: 1 });
    globalThis.fetch = convex.fetch;
    const userId = `convex-user-${crypto.randomUUID()}`;

    const call = (runKey?: string) =>
      app.request("/gx/openai/chat-completions", {
        method: "POST",
        headers: {
          ...authHeaders(userId, orgId),
          "Content-Type": "application/json",
          ...(runKey ? { "X-GX-Run": runKey } : {}),
        },
        body: JSON.stringify(chatPayload),
      });

    // Several calls inside one run: the gate passes every time (the route
    // then fails upstream for want of an OpenAI key, which is not a 402).
    expect((await call("review-1")).status).not.toBe(402);
    expect((await call("review-1")).status).not.toBe(402);
    expect((await call("review-1")).status).not.toBe(402);
    expect(convex.calls.filter((c) => c.run_key === "review-1")).toHaveLength(3);

    // The next run is refused.
    const refused = await call("review-2");
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { reason: string }).reason).toBe(
      "free_runs_exhausted",
    );
  });

  test("a proxy call with no run key spends a run of its own", async () => {
    const convex = fakeConvex({ limit: 1 });
    globalThis.fetch = convex.fetch;
    const userId = `convex-user-${crypto.randomUUID()}`;

    const call = () =>
      app.request("/gx/openai/chat-completions", {
        method: "POST",
        headers: {
          ...authHeaders(userId, orgId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chatPayload),
      });

    expect((await call()).status).not.toBe(402);
    expect((await call()).status).toBe(402);
    const keys = convex.calls.map((c) => c.run_key);
    expect(new Set(keys).size).toBe(2);
  });

  test("reserve rejects a body without run_key", async () => {
    globalThis.fetch = fakeConvex({ limit: 1 }).fetch;
    const response = await app.request("/v1/runs/reserve", {
      method: "POST",
      headers: {
        ...authHeaders("convex-user-x", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "review" }),
    });
    expect(response.status).toBe(400);
  });

  test("a PR Summary reserves under its bookmark, so a redelivery is free", async () => {
    const convex = fakeConvex({ limit: 1 });
    globalThis.fetch = convex.fetch;
    const db = getSql();
    const userId = `convex-user-${crypto.randomUUID()}`;
    const now = Date.now();

    const [event] = await db<{ id: string }[]>`
      INSERT INTO pr_events (
        created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
      ) VALUES (
        ${now}, '0.1.0-test', ${`runs-${userId}`},
        ${JSON.stringify({ refRange: "main..HEAD", intentCandidates: ["runs test"] })}::jsonb,
        ${orgId}, ${userId}, '/Users/joe/git/gx'
      )
      RETURNING id
    `;
    const [bookmark] = await db<{ id: string }[]>`
      INSERT INTO bookmarks (
        user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
      ) VALUES (
        ${userId}, ${`acme/runs-${userId}`}, 'feat/runs', ${now}, ${now}, ${orgId}, ${event.id}
      )
      RETURNING id
    `;
    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${orgId}, ${event.id}, 'server/src/metering/quota.ts', 1, 10,
        ${`runs-session-${userId}`}, 1, 0.9, 'agent', 'cursor', 'mock'
      )
    `;

    await generateSummary(db, {
      orgId,
      userId,
      bookmarkId: bookmark.id,
      provider: createMockProvider("runs summary"),
    });
    expect(convex.calls).toHaveLength(1);
    expect(convex.calls[0]).toMatchObject({
      user_id: userId,
      kind: "pr_summary",
      run_key: prSummaryRunKey(orgId, bookmark.id),
    });

    // Regenerating for the same bookmark is already counted in review_usage
    // and never reaches Convex at all.
    await generateSummary(db, {
      orgId,
      userId,
      bookmarkId: bookmark.id,
      provider: createMockProvider("runs summary again"),
    });
    expect(convex.calls).toHaveLength(1);
  });
});
