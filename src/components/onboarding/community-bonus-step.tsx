"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Check } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { DiscordIcon } from "@/components/discord-icon";
import { TwitterIcon } from "@/components/twitter-icon";
import {
  DISCORD_URL,
  TWITTER_HANDLE,
  TWITTER_URL,
  withOnboardingParam,
} from "@/lib/site-links";
import {
  BASE_FREE_RUNS,
  DISCORD_BONUS_RUNS,
  GITHUB_STAR_BONUS_RUNS,
  TWITTER_BONUS_RUNS,
} from "../../../convex/lib/freeRuns";

function BonusRow({
  bonusRuns,
  claimed,
  href,
  icon,
  label,
  onClaim,
}: {
  bonusRuns: number;
  claimed: boolean;
  href: string;
  icon: ReactNode;
  label: string;
  onClaim: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-x-3 gap-y-2">
      <p className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
        <span className="text-zinc-950 dark:text-zinc-50">{icon}</span>
        {label}
        <span className="text-[11px] text-zinc-500">+{bonusRuns} runs</span>
      </p>
      {claimed ? (
        <p className="flex shrink-0 items-center gap-1.5 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
          <Check className="h-3 w-3 shrink-0" />
          Thank you
        </p>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={onClaim}
          className="group inline-flex shrink-0 cursor-pointer items-center gap-1.5 border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
        >
          {label}
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      )}
    </div>
  );
}

export function CommunityBonusStep() {
  const searchParams = useSearchParams();
  const forceOnboarding = searchParams.get("onboarding") === "1";
  const appState = useQuery(api.userAppState.getMyAppState);
  const claimDiscordBonus = useMutation(api.userAppState.claimDiscordBonus);
  const claimTwitterBonus = useMutation(api.userAppState.claimTwitterBonus);
  const completeCommunityScreen = useMutation(
    api.userAppState.completeCommunityScreen,
  );

  const [claimedDiscord, setClaimedDiscord] = useState(false);
  const [claimedTwitter, setClaimedTwitter] = useState(false);

  // GitHub star is no longer offered, but earlier claims still count toward the total.
  const githubStarBonusClaimed = Boolean(appState?.githubStarBonusClaimed);
  const discordBonusClaimed =
    Boolean(appState?.discordBonusClaimed) || claimedDiscord;
  const twitterBonusClaimed =
    Boolean(appState?.twitterBonusClaimed) || claimedTwitter;

  // Compute from claimed flags × shared +2 constants only.
  const freeRunsTotal =
    BASE_FREE_RUNS +
    (githubStarBonusClaimed ? GITHUB_STAR_BONUS_RUNS : 0) +
    (discordBonusClaimed ? DISCORD_BONUS_RUNS : 0) +
    (twitterBonusClaimed ? TWITTER_BONUS_RUNS : 0);

  function markCommunityScreenComplete() {
    void completeCommunityScreen({}).catch((error: unknown) => {
      console.error("Failed to complete community screen", error);
    });
  }

  if (appState === undefined || appState === null) {
    return (
      <div className="flex justify-center py-12">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <BonusRow
          bonusRuns={DISCORD_BONUS_RUNS}
          claimed={discordBonusClaimed}
          href={DISCORD_URL}
          icon={<DiscordIcon className="h-3.5 w-3.5" />}
          label="Join Discord"
          onClaim={() => {
            setClaimedDiscord(true);
            void claimDiscordBonus({});
          }}
        />
        <BonusRow
          bonusRuns={TWITTER_BONUS_RUNS}
          claimed={twitterBonusClaimed}
          href={TWITTER_URL}
          icon={<TwitterIcon className="h-3.5 w-3.5" />}
          label={`Follow ${TWITTER_HANDLE}`}
          onClaim={() => {
            setClaimedTwitter(true);
            void claimTwitterBonus({});
          }}
        />
      </div>

      <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
        Free runs: {freeRunsTotal} · optional
      </p>

      <div className="flex justify-end">
        <Link
          href={withOnboardingParam("/onboarding", forceOnboarding)}
          onClick={markCommunityScreenComplete}
          className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
    </div>
  );
}
