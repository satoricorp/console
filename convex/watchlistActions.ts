import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Cron entrypoint for the OSS "watch" rail.
 *
 * Convex owns the schedule (crons.ts) and the list (watchlist.ts). This action
 * is the one-directional bridge to the server, which owns the heavy lifting
 * (fetch PRs → generate summary → post as the TX bot). Running on a Convex cron
 * means exactly one invocation per tick regardless of how many server replicas
 * exist — no leader election / advisory lock needed.
 *
 * The server route is authenticated with TX_CLOUD_API_KEY, the same shared
 * secret the server already uses to call Convex (/cx/trial/entitlement).
 */
export const runWatchTick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const base = process.env.TX_SERVER_INTERNAL_URL?.trim();
    const apiKey = process.env.TX_CLOUD_API_KEY?.trim();
    if (!base || !apiKey) {
      console.info("watch tick skipped: TX_SERVER_INTERNAL_URL / TX_CLOUD_API_KEY not set");
      return;
    }

    const repos = await ctx.runQuery(internal.watchlist.listEnabled, {});
    if (repos.length === 0) {
      return;
    }

    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}/internal/watch/tick`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "tx-convex-cron",
        },
        body: JSON.stringify({ repos }),
      });
    } catch (error) {
      console.error("watch tick: server unreachable", {
        error: error instanceof Error ? error.message : String(error),
        repoCount: repos.length,
      });
      return;
    }

    if (!response.ok) {
      console.error("watch tick: server returned error", {
        status: response.status,
        body: (await response.text()).slice(0, 500),
      });
      return;
    }

    console.info("watch tick dispatched", { repoCount: repos.length });
  },
});
