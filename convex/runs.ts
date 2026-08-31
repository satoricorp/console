import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components } from "./_generated/api";
import { authComponent } from "./auth";
import { computeFreeRuns } from "./lib/freeRuns";
import { getOrCreateUserAppState } from "./userAppState";

const runKind = v.union(v.literal("review"), v.literal("pr_summary"));

/** Where a user who has used up their free runs goes to subscribe. */
export function checkoutUrl(): string {
  const site = (process.env.SITE_URL ?? "https://gx.run").replace(/\/+$/, "");
  return `${site}/checkout`;
}

async function hasActiveSubscription(ctx: QueryCtx, userId: string) {
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  return Boolean(
    subscription &&
      (subscription.status === "active" || subscription.status === "trialing"),
  );
}

async function freeRunLimit(ctx: QueryCtx, userId: string) {
  const state = await ctx.db
    .query("userAppStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  return computeFreeRuns(state ?? {});
}

/**
 * How many runs the user has recorded, capped at limit + 1: the gate only
 * needs to know whether the limit is reached, so this never has to read a
 * long-time subscriber's whole history.
 */
async function runsUsed(ctx: QueryCtx, userId: string, limit: number) {
  const rows = await ctx.db
    .query("runUsage")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(limit + 1);
  return rows.length;
}

export type RunReservation = {
  allowed: boolean;
  reason:
    | "subscribed"
    | "free_run"
    | "already_reserved"
    | "free_runs_exhausted"
    | "unknown_user";
  subscribed: boolean;
  used: number;
  limit: number;
  remaining: number;
  checkoutUrl: string;
};

/**
 * Reserve one gx Cloud AI run for a user, called by the gx Cloud server before
 * a review or PR Summary runs. Subscribers always pass; otherwise the run is
 * recorded against the free allowance and refused once it is spent. The same
 * runKey reserves at most once, so every model call inside one review — or a
 * PR Summary GitHub delivers twice — costs one run.
 */
export async function reserveRunForUser(
  ctx: MutationCtx,
  args: { userId: string; kind: "review" | "pr_summary"; runKey: string },
): Promise<RunReservation> {
  const { userId, kind, runKey } = args;
  const limit = await freeRunLimit(ctx, userId);
  const subscribed = await hasActiveSubscription(ctx, userId);
  const used = await runsUsed(ctx, userId, limit);
  const url = checkoutUrl();

  const existing = await ctx.db
    .query("runUsage")
    .withIndex("by_userId_runKey", (q) =>
      q.eq("userId", userId).eq("runKey", runKey),
    )
    .unique();

  if (subscribed) {
    if (!existing) {
      await ctx.db.insert("runUsage", {
        userId,
        kind,
        runKey,
        createdAt: Date.now(),
      });
    }
    return {
      allowed: true,
      reason: "subscribed",
      subscribed: true,
      used: Math.min(used + (existing ? 0 : 1), limit),
      limit,
      remaining: 0,
      checkoutUrl: url,
    };
  }

  if (existing) {
    return {
      allowed: true,
      reason: "already_reserved",
      subscribed: false,
      used: Math.min(used, limit),
      limit,
      remaining: Math.max(limit - used, 0),
      checkoutUrl: url,
    };
  }

  if (used >= limit) {
    return {
      allowed: false,
      reason: "free_runs_exhausted",
      subscribed: false,
      used: limit,
      limit,
      remaining: 0,
      checkoutUrl: url,
    };
  }

  await ctx.db.insert("runUsage", {
    userId,
    kind,
    runKey,
    createdAt: Date.now(),
  });
  return {
    allowed: true,
    reason: "free_run",
    subscribed: false,
    used: used + 1,
    limit,
    remaining: limit - used - 1,
    checkoutUrl: url,
  };
}

export const reserveRun = internalMutation({
  args: { userId: v.string(), kind: runKind, runKey: v.string() },
  handler: async (ctx, args): Promise<RunReservation | null> => {
    const user = await authComponent.getAnyUserById(ctx, args.userId);
    if (!user) {
      return null;
    }
    return await reserveRunForUser(ctx, args);
  },
});

/** The signed-in user's free-run position, for the checkout and community pages. */
export const getMyRunUsage = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const limit = await freeRunLimit(ctx, user._id);
    const subscribed = await hasActiveSubscription(ctx, user._id);
    const used = Math.min(await runsUsed(ctx, user._id, limit), limit);
    return {
      subscribed,
      used,
      limit,
      remaining: Math.max(limit - used, 0),
    };
  },
});

async function resolveUserId(
  ctx: QueryCtx,
  args: { userId?: string; email?: string },
): Promise<string | null> {
  if (args.userId) {
    const user = await authComponent.getAnyUserById(ctx, args.userId);
    return user ? args.userId : null;
  }
  if (args.email) {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: args.email }],
    })) as { _id: string } | null;
    return user?._id ?? null;
  }
  return null;
}

async function runUsageSummary(ctx: QueryCtx, userId: string) {
  const state = await ctx.db
    .query("userAppStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  const limit = computeFreeRuns(state ?? {});
  const subscribed = await hasActiveSubscription(ctx, userId);
  const used = Math.min(await runsUsed(ctx, userId, limit), limit);
  return {
    userId,
    subscribed,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    freeRunsOverride: state?.freeRunsOverride ?? null,
  };
}

// Operator tool: invoked by hand from the Convex dashboard.
/**
 * Admin: set how many free runs one user gets, by userId or email. The number
 * replaces the whole allowance (base + community bonuses); omit freeRuns to
 * clear the override and return to the computed default. Returns the user's
 * resulting position so the effect is visible immediately.
 */
export const setFreeRunsOverride = internalMutation({
  args: {
    userId: v.optional(v.string()),
    email: v.optional(v.string()),
    freeRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserId(ctx, args);
    if (!userId) {
      throw new Error("No user found for the given userId/email");
    }
    if (args.freeRuns !== undefined && (!Number.isFinite(args.freeRuns) || args.freeRuns < 0)) {
      throw new Error("freeRuns must be a non-negative number");
    }

    const state = await getOrCreateUserAppState(ctx, userId);
    await ctx.db.patch(state._id, {
      // undefined removes the field, which is exactly what clearing means.
      freeRunsOverride:
        args.freeRuns === undefined ? undefined : Math.floor(args.freeRuns),
      updatedAt: Date.now(),
    });

    return await runUsageSummary(ctx, userId);
  },
});

// Operator tool: invoked by hand from the Convex dashboard.
/** Admin: one user's run position (used/limit/override/subscription), by userId or email. */
export const getRunUsageForUser = internalQuery({
  args: { userId: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveUserId(ctx, args);
    if (!userId) {
      throw new Error("No user found for the given userId/email");
    }
    return await runUsageSummary(ctx, userId);
  },
});

// Operator tool: invoked by hand from the Convex dashboard.
/**
 * Admin: everyone who has spent at least one run, with email and how many
 * they have left. Reads the whole ledger — fine at the current user count,
 * like listWindowsCliRequests above it in spirit.
 */
export const listRunUsage = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("runUsage").collect();
    const byUser = new Map<string, number>();
    for (const row of rows) {
      byUser.set(row.userId, (byUser.get(row.userId) ?? 0) + 1);
    }

    const out = [];
    for (const [userId, used] of byUser) {
      const user = await authComponent.getAnyUserById(ctx, userId);
      const state = await ctx.db
        .query("userAppStates")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      const limit = computeFreeRuns(state ?? {});
      out.push({
        userId,
        email: user?.email ?? null,
        subscribed: await hasActiveSubscription(ctx, userId),
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        freeRunsOverride: state?.freeRunsOverride ?? null,
      });
    }
    return out.sort((a, b) => b.used - a.used);
  },
});
