import { mutation, query, type MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import {
  BASE_TRIAL_DAYS,
  computeTrialDays,
  DISCORD_BONUS_DAYS,
  GITHUB_STAR_BONUS_DAYS,
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
  downloadScreenCompletedAt?: number;
  communityScreenCompletedAt?: number;
  githubStarBonusClaimedAt?: number;
  discordBonusClaimedAt?: number;
}) {
  return {
    downloadScreenCompleted: Boolean(state.downloadScreenCompletedAt),
    downloadScreenCompletedAt: state.downloadScreenCompletedAt ?? null,
    communityScreenCompleted: Boolean(state.communityScreenCompletedAt),
    communityScreenCompletedAt: state.communityScreenCompletedAt ?? null,
    githubStarBonusClaimed: Boolean(state.githubStarBonusClaimedAt),
    discordBonusClaimed: Boolean(state.discordBonusClaimedAt),
    baseTrialDays: BASE_TRIAL_DAYS,
    githubStarBonusDays: GITHUB_STAR_BONUS_DAYS,
    discordBonusDays: DISCORD_BONUS_DAYS,
    trialDaysTotal: computeTrialDays(state),
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
        githubStarBonusClaimed: false,
        discordBonusClaimed: false,
        baseTrialDays: BASE_TRIAL_DAYS,
        githubStarBonusDays: GITHUB_STAR_BONUS_DAYS,
        discordBonusDays: DISCORD_BONUS_DAYS,
        trialDaysTotal: BASE_TRIAL_DAYS,
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
