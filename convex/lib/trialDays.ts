export const BASE_TRIAL_DAYS = 7;
export const GITHUB_STAR_BONUS_DAYS = 3;
export const DISCORD_BONUS_DAYS = 3;

export function computeTrialDays(state: {
  githubStarBonusClaimedAt?: number;
  discordBonusClaimedAt?: number;
}) {
  let days = BASE_TRIAL_DAYS;
  if (state.githubStarBonusClaimedAt) {
    days += GITHUB_STAR_BONUS_DAYS;
  }
  if (state.discordBonusClaimedAt) {
    days += DISCORD_BONUS_DAYS;
  }
  return days;
}
