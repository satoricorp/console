import { Hono } from "hono";
import { getSql } from "../db";
import { runWatchTick, type WatchRepoInput } from "../watch/tick";

export const watchRoutes = new Hono();

/** Feature flag — the whole rail stays dormant until this is explicitly on. */
function watchEnabled(): boolean {
  const flag = process.env.TX_WATCH_ENABLED?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/**
 * Internal tick endpoint, called only by the Convex cron
 * (convex/watchlistActions.ts). Authenticated with TX_CLOUD_API_KEY — the same
 * shared secret the server uses to call Convex — so it is not client-reachable.
 */
watchRoutes.post("/internal/watch/tick", async (c) => {
  const expected = process.env.TX_CLOUD_API_KEY?.trim();
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!expected || token !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Dormant by default: acknowledge with 200 so the cron doesn't error-spam,
  // but do no work until the operator flips the flag on.
  if (!watchEnabled()) {
    return c.json({ ok: true, disabled: true });
  }

  if (!process.env.TX_WATCH_GITHUB_TOKEN?.trim()) {
    return c.json({ error: "TX_WATCH_GITHUB_TOKEN is not set" }, 500);
  }

  let body: { repos?: WatchRepoInput[] };
  try {
    body = (await c.req.json()) as { repos?: WatchRepoInput[] };
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const repos = (body.repos ?? []).filter(
    (r): r is WatchRepoInput => typeof r?.fullName === "string" && r.fullName.includes("/"),
  );
  if (repos.length === 0) {
    return c.json({ ok: true, reposProcessed: 0 });
  }

  try {
    const result = await runWatchTick(getSql(), { repos });
    return c.json({ ok: true, ...result });
  } catch (error) {
    console.error("watch tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: "watch tick failed" }, 500);
  }
});
