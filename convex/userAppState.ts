import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import {
  BASE_TRIAL_DAYS,
  computeTrialDays,
  computeTrialEndsAt,
  DISCORD_BONUS_DAYS,
  GITHUB_STAR_BONUS_DAYS,
  TWITTER_BONUS_DAYS,
} from "./lib/trialDays";

async function getOrCreateUserAppState(ctx: MutationCtx, userId: string) {
  const existing = await ctx.db
    .query("userAppStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  if (existing) {
    return existing;
  }

  const now = Date.now();
  const id = await ctx.db.insert("userAppStates", {
    userId,
    createdAt: now,
    updatedAt: now,
  });

  const created = await ctx.db.get("userAppStates", id);
  if (!created) {
    throw new Error("Could not create app state");
  }

  return created;
}

function formatAppState(state: {
  githubStarBonusClaimedAt?: number;
  discordBonusClaimedAt?: number;
  twitterBonusClaimedAt?: number;
  downloadScreenCompletedAt?: number;
  communityScreenCompletedAt?: number;
  githubAppInstallScreenCompletedAt?: number;
  onboardingCompletedAt?: number;
  windowsCliRequestedAt?: number;
}) {
  return {
    downloadScreenCompleted: Boolean(state.downloadScreenCompletedAt),
    downloadScreenCompletedAt: state.downloadScreenCompletedAt ?? null,
    communityScreenCompleted: Boolean(state.communityScreenCompletedAt),
    communityScreenCompletedAt: state.communityScreenCompletedAt ?? null,
    githubAppInstallScreenCompleted: Boolean(
      state.githubAppInstallScreenCompletedAt,
    ),
    githubAppInstallScreenCompletedAt:
      state.githubAppInstallScreenCompletedAt ?? null,
    onboardingCompleted: Boolean(state.onboardingCompletedAt),
    onboardingCompletedAt: state.onboardingCompletedAt ?? null,
    githubStarBonusClaimed: Boolean(state.githubStarBonusClaimedAt),
    discordBonusClaimed: Boolean(state.discordBonusClaimedAt),
    twitterBonusClaimed: Boolean(state.twitterBonusClaimedAt),
    windowsCliRequested: Boolean(state.windowsCliRequestedAt),
    baseTrialDays: BASE_TRIAL_DAYS,
    githubStarBonusDays: GITHUB_STAR_BONUS_DAYS,
    discordBonusDays: DISCORD_BONUS_DAYS,
    twitterBonusDays: TWITTER_BONUS_DAYS,
    trialDaysTotal: computeTrialDays(state),
  };
}

/**
 * Paywall kill switch — OFF by default, so every signed-in user has full GX
 * Cloud AI access regardless of subscription or trial age.
 *
 * Set `GX_PAYWALL_ENABLED=1` in the Convex dashboard to turn billing back on;
 * that is the only step, which is why the trial/subscription logic below is
 * left fully intact rather than deleted. This is the decisive gate: the server
 * short-circuits on this answer and never reaches its Postgres org-trial
 * fallback for users that exist in Convex (server/src/metering/quota.ts:162-184).
 */
function paywallEnabled(): boolean {
  const raw = process.env.GX_PAYWALL_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

async function trialEntitlementForUser(ctx: QueryCtx, userId: string) {
  const user = await authComponent.getAnyUserById(ctx, userId);
  if (!user) {
    return null;
  }

  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .first();

  if (
    subscription &&
    (subscription.status === "active" || subscription.status === "trialing")
  ) {
    return {
      allowed: true,
      reason: "subscribed" as const,
      trialDaysTotal: null,
      trialEndsAt: null,
      startedAt: user.createdAt ?? null,
    };
  }

  const state = await ctx.db
    .query("userAppStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  const startedAt = user.createdAt ?? state?.createdAt ?? Date.now();
  const trialDaysTotal = computeTrialDays(state ?? {});
  const trialEndsAt = computeTrialEndsAt(startedAt, state ?? {});

  // Paywall off: report the real trial figures for the UI, but never deny.
  if (!paywallEnabled()) {
    return {
      allowed: true,
      reason: "unrestricted" as const,
      trialDaysTotal,
      trialEndsAt,
      startedAt,
    };
  }

  return {
    allowed: Date.now() < trialEndsAt,
    reason: "trial" as const,
    trialDaysTotal,
    trialEndsAt,
    startedAt,
  };
}

export const getMyAppState = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const state = await ctx.db
      .query("userAppStates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    if (!state) {
      return {
        downloadScreenCompleted: false,
        downloadScreenCompletedAt: null,
        communityScreenCompleted: false,
        communityScreenCompletedAt: null,
        githubAppInstallScreenCompleted: false,
        githubAppInstallScreenCompletedAt: null,
        onboardingCompleted: false,
        onboardingCompletedAt: null,
        githubStarBonusClaimed: false,
        discordBonusClaimed: false,
        twitterBonusClaimed: false,
        windowsCliRequested: false,
        baseTrialDays: BASE_TRIAL_DAYS,
        githubStarBonusDays: GITHUB_STAR_BONUS_DAYS,
        discordBonusDays: DISCORD_BONUS_DAYS,
        twitterBonusDays: TWITTER_BONUS_DAYS,
        trialDaysTotal: BASE_TRIAL_DAYS,
      };
    }

    return formatAppState(state);
  },
});

export const getTrialEntitlement = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await trialEntitlementForUser(ctx, userId);
  },
});

export const completeDownloadScreen = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    await ctx.db.patch(existing._id, {
      downloadScreenCompletedAt: existing.downloadScreenCompletedAt ?? now,
      updatedAt: now,
    });
  },
});

export const requestWindowsCli = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    if (existing.windowsCliRequestedAt) {
      return formatAppState(existing);
    }

    await ctx.db.patch(existing._id, {
      windowsCliRequestedAt: now,
      updatedAt: now,
    });

    const updated = await ctx.db.get("userAppStates", existing._id);
    if (!updated) {
      throw new Error("Could not update app state");
    }

    return formatAppState(updated);
  },
});

// Operator tool: invoked by hand from the Convex dashboard.
/** Admin: everyone who requested a native Windows CLI build, with contact emails. */
export const listWindowsCliRequests = internalQuery({
  args: {},
  handler: async (ctx) => {
    const states = await ctx.db.query("userAppStates").collect();
    const requests = states
      .filter((state) => state.windowsCliRequestedAt)
      .sort(
        (a, b) => (a.windowsCliRequestedAt ?? 0) - (b.windowsCliRequestedAt ?? 0),
      );

    return await Promise.all(
      requests.map(async (state) => {
        const user = await authComponent.getAnyUserById(ctx, state.userId);
        return {
          userId: state.userId,
          email: user?.email ?? null,
          name: user?.name ?? null,
          requestedAt: state.windowsCliRequestedAt ?? null,
        };
      }),
    );
  },
});

export const claimGithubStarBonus = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    if (existing.githubStarBonusClaimedAt) {
      return formatAppState(existing);
    }

    await ctx.db.patch(existing._id, {
      githubStarBonusClaimedAt: now,
      updatedAt: now,
    });

    const updated = await ctx.db.get("userAppStates", existing._id);
    if (!updated) {
      throw new Error("Could not update app state");
    }

    return formatAppState(updated);
  },
});

export const claimDiscordBonus = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    if (existing.discordBonusClaimedAt) {
      return formatAppState(existing);
    }

    await ctx.db.patch(existing._id, {
      discordBonusClaimedAt: now,
      updatedAt: now,
    });

    const updated = await ctx.db.get("userAppStates", existing._id);
    if (!updated) {
      throw new Error("Could not update app state");
    }

    return formatAppState(updated);
  },
});

export const claimTwitterBonus = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    if (existing.twitterBonusClaimedAt) {
      return formatAppState(existing);
    }

    await ctx.db.patch(existing._id, {
      twitterBonusClaimedAt: now,
      updatedAt: now,
    });

    const updated = await ctx.db.get("userAppStates", existing._id);
    if (!updated) {
      throw new Error("Could not update app state");
    }

    return formatAppState(updated);
  },
});

export const completeCommunityScreen = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    await ctx.db.patch(existing._id, {
      communityScreenCompletedAt: existing.communityScreenCompletedAt ?? now,
      updatedAt: now,
    });
  },
});

export const completeGithubAppInstallScreen = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    await ctx.db.patch(existing._id, {
      githubAppInstallScreenCompletedAt:
        existing.githubAppInstallScreenCompletedAt ?? now,
      updatedAt: now,
    });
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("Sign in to continue");

    const now = Date.now();
    const existing = await getOrCreateUserAppState(ctx, user._id);

    await ctx.db.patch(existing._id, {
      onboardingCompletedAt: existing.onboardingCompletedAt ?? now,
      updatedAt: now,
    });
  },
});
