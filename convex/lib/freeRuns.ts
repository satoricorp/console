/**
 * Free usage is counted in runs, not days: every account gets BASE_FREE_RUNS
 * gx Cloud AI runs (a `gx review` or a PR Summary each count as one), and the
 * community bonuses add a couple more. Past that, Cloud AI needs a subscription.
 */
export const BASE_FREE_RUNS = 7;
export const GITHUB_STAR_BONUS_RUNS = 2;
export const DISCORD_BONUS_RUNS = 2;
export const TWITTER_BONUS_RUNS = 2;

export type BonusClaims = {
  githubStarBonusClaimedAt?: number;
  discordBonusClaimedAt?: number;
  twitterBonusClaimedAt?: number;
};

export function computeFreeRuns(state: BonusClaims) {
  let runs = BASE_FREE_RUNS;
  if (state.githubStarBonusClaimedAt) {
    runs += GITHUB_STAR_BONUS_RUNS;
  }
  if (state.discordBonusClaimedAt) {
    runs += DISCORD_BONUS_RUNS;
  }
  if (state.twitterBonusClaimedAt) {
    runs += TWITTER_BONUS_RUNS;
  }
  return runs;
}
