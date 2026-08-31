import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import {
  BASE_FREE_RUNS,
  computeFreeRuns,
  DISCORD_BONUS_RUNS,
  GITHUB_STAR_BONUS_RUNS,
  TWITTER_BONUS_RUNS,
} from "./lib/freeRuns";

export async function getOrCreateUserAppState(ctx: MutationCtx, userId: string) {
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
    baseFreeRuns: BASE_FREE_RUNS,
    githubStarBonusRuns: GITHUB_STAR_BONUS_RUNS,
    discordBonusRuns: DISCORD_BONUS_RUNS,
    twitterBonusRuns: TWITTER_BONUS_RUNS,
    freeRunsTotal: computeFreeRuns(state),
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
        baseFreeRuns: BASE_FREE_RUNS,
        githubStarBonusRuns: GITHUB_STAR_BONUS_RUNS,
        discordBonusRuns: DISCORD_BONUS_RUNS,
        twitterBonusRuns: TWITTER_BONUS_RUNS,
        freeRunsTotal: BASE_FREE_RUNS,
      };
    }

    return formatAppState(state);
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
