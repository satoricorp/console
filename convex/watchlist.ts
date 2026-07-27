import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * OSS "watch" rail — operator-only watchlist management.
 *
 * Every export here is an `internalMutation`/`internalQuery`, which Convex does
 * NOT expose to browser/client callers. They can only be invoked from the
 * Convex dashboard, the CLI, or other server-side Convex functions (the cron).
 * That is the structural "only I add URLs" guarantee: there is no client path
 * that writes this table, so a repo can only join the free rail if the operator
 * runs one of these by hand.
 *
 * Add a repo from the Convex dashboard (Functions → run) or CLI:
 *   npx convex run watchlist:addWatchedRepo '{"fullName":"anomalyco/opencode"}'
 */

function normalizeFullName(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  const raw = fromUrl ? `${fromUrl[1]}/${fromUrl[2]}` : trimmed;
  return raw.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
}

export const addWatchedRepo = internalMutation({
  args: {
    fullName: v.string(),
    campaign: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fullName = normalizeFullName(args.fullName);
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
      throw new Error(`Not an "owner/name" repo or GitHub URL: ${args.fullName}`);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("watchedRepos")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: true,
        campaign: args.campaign ?? existing.campaign,
        note: args.note ?? existing.note,
        updatedAt: now,
      });
      return { fullName, status: "reenabled" as const };
    }

    await ctx.db.insert("watchedRepos", {
      fullName,
      campaign: args.campaign ?? "oss-watch",
      enabled: true,
      note: args.note,
      addedAt: now,
      updatedAt: now,
    });
    return { fullName, status: "added" as const };
  },
});

export const setWatchedRepoEnabled = internalMutation({
  args: { fullName: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const fullName = normalizeFullName(args.fullName);
    const existing = await ctx.db
      .query("watchedRepos")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .unique();
    if (!existing) {
      throw new Error(`Not on the watchlist: ${fullName}`);
    }
    await ctx.db.patch(existing._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return { fullName, enabled: args.enabled };
  },
});

/** Read side for the cron action. Internal — never client-reachable. */
export const listEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("watchedRepos")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    return rows.map((row) => ({
      fullName: row.fullName,
      campaign: row.campaign ?? "oss-watch",
    }));
  },
});
