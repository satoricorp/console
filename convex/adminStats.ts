import { internalQuery } from "./_generated/server";
import { components } from "./_generated/api";
import { computeFreeRuns } from "./lib/freeRuns";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

// Statuses the run gate treats as subscribed (see runs.hasActiveSubscription).
const SUBSCRIBED_STATUSES = new Set(["active", "trialing"]);

/**
 * Operator dashboard rollup, read by scripts/status.sh via
 * `npx convex run adminStats:overview --prod`. Reads every row of the small
 * tables (users, subscriptions, runUsage, userAppStates) and aggregates —
 * fine at current scale, revisit past a few thousand users.
 */
export const overview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Every auth user, paged out of the Better Auth component.
    const users: Array<{ _id: string; createdAt?: number; _creationTime: number }> = [];
    let cursor: string | null = null;
    for (;;) {
      const result: {
        page: Array<{ _id: string; createdAt?: number; _creationTime: number }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor, numItems: 200 },
      });
      users.push(...result.page);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const userCreatedAt = (u: (typeof users)[number]) =>
      u.createdAt ?? u._creationTime;

    const subscriptions = await ctx.db.query("subscriptions").collect();
    const runUsage = await ctx.db.query("runUsage").collect();
    const appStates = await ctx.db.query("userAppStates").collect();

    // Latest subscription row per user decides their status, matching the
    // run-reserve gate.
    const latestSubByUser = new Map<string, (typeof subscriptions)[number]>();
    const earliestSubStartByUser = new Map<string, number>();
    for (const sub of subscriptions) {
      const prior = latestSubByUser.get(sub.userId);
      if (!prior || sub._creationTime > prior._creationTime) {
        latestSubByUser.set(sub.userId, sub);
      }
      const earliest = earliestSubStartByUser.get(sub.userId);
      if (earliest === undefined || sub._creationTime < earliest) {
        earliestSubStartByUser.set(sub.userId, sub._creationTime);
      }
    }

    const subscribedUserIds = new Set<string>();
    const subscriptionStatusCounts: Record<string, number> = {};
    for (const [userId, sub] of latestSubByUser) {
      subscriptionStatusCounts[sub.status] =
        (subscriptionStatusCounts[sub.status] ?? 0) + 1;
      if (SUBSCRIBED_STATUSES.has(sub.status)) {
        subscribedUserIds.add(userId);
      }
    }

    // Subscribers whose subscription started over a month ago — i.e. they
    // renewed into (at least) a second month.
    let inSecondMonthOrLater = 0;
    for (const userId of subscribedUserIds) {
      const start = earliestSubStartByUser.get(userId);
      if (start !== undefined && now - start >= MONTH_MS) {
        inSecondMonthOrLater += 1;
      }
    }

    const runsByUser = new Map<string, number>();
    let reviewRuns = 0;
    let prSummaryRuns = 0;
    let runsLast24h = 0;
    for (const run of runUsage) {
      runsByUser.set(run.userId, (runsByUser.get(run.userId) ?? 0) + 1);
      if (run.kind === "review") reviewRuns += 1;
      else prSummaryRuns += 1;
      if (run.createdAt >= now - DAY_MS) runsLast24h += 1;
    }

    const stateByUser = new Map(appStates.map((s) => [s.userId, s]));
    const freeRunLimit = (userId: string) =>
      computeFreeRuns(stateByUser.get(userId) ?? {});

    // Free-tier funnel over the full user list. "Trial" here means using the
    // free-run allowance: not subscribed, at least one run recorded, allowance
    // not yet spent.
    let onTrial = 0;
    let neverRan = 0;
    let exhaustedNotSubscribed = 0;
    let pastFreeRuns = 0; // used >= allowance, regardless of subscription
    for (const user of users) {
      const used = runsByUser.get(user._id) ?? 0;
      const exhausted = used >= freeRunLimit(user._id);
      if (exhausted) pastFreeRuns += 1;
      if (subscribedUserIds.has(user._id)) continue;
      if (exhausted) exhaustedNotSubscribed += 1;
      else if (used > 0) onTrial += 1;
      else neverRan += 1;
    }

    return {
      generatedAt: now,
      users: {
        total: users.length,
        newLast24h: users.filter((u) => userCreatedAt(u) >= now - DAY_MS)
          .length,
      },
      freeTier: {
        onTrial,
        neverRan,
        exhaustedNotSubscribed,
        pastFreeRuns,
      },
      billing: {
        paying: subscribedUserIds.size,
        inSecondMonthOrLater,
        statusCounts: subscriptionStatusCounts,
      },
      runs: {
        total: runUsage.length,
        reviews: reviewRuns,
        prSummaries: prSummaryRuns,
        last24h: runsLast24h,
      },
    };
  },
});
