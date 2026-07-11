export const BASE_TRIAL_DAYS = 7;
export const GITHUB_STAR_BONUS_DAYS = 2;
export const DISCORD_BONUS_DAYS = 2;
export const TWITTER_BONUS_DAYS = 2;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeTrialDays(state: {
  githubStarBonusClaimedAt?: number;
  discordBonusClaimedAt?: number;
  twitterBonusClaimedAt?: number;
}) {
  let days = BASE_TRIAL_DAYS;
  if (state.githubStarBonusClaimedAt) {
    days += GITHUB_STAR_BONUS_DAYS;
  }
  if (state.discordBonusClaimedAt) {
    days += DISCORD_BONUS_DAYS;
  }
  if (state.twitterBonusClaimedAt) {
    days += TWITTER_BONUS_DAYS;
  }
  return days;
}

export function computeTrialEndsAt(
  startedAtMs: number,
  state: {
    githubStarBonusClaimedAt?: number;
    discordBonusClaimedAt?: number;
    twitterBonusClaimedAt?: number;
  },
) {
  return startedAtMs + computeTrialDays(state) * MS_PER_DAY;
}
