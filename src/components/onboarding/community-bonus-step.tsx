"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { DiscordIcon } from "@/components/discord-icon";
import { GitHubIcon } from "@/components/github-icon";
import { TwitterIcon } from "@/components/twitter-icon";
import {
  DISCORD_URL,
  GITHUB_REPO_URL,
  TWITTER_HANDLE,
  TWITTER_URL,
} from "@/lib/site-links";

const BONUS_DAYS = 2;

function BonusRow({
  claimed,
  href,
  icon,
  label,
  onClaim,
}: {
  claimed: boolean;
  href: string;
  icon: ReactNode;
  label: string;
  onClaim: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="flex items-center gap-1.5 text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
        <span className="text-zinc-950 dark:text-zinc-50">{icon}</span>
        {label}
        <span className="text-[11px] text-zinc-500">+{BONUS_DAYS} days</span>
      </p>
      {claimed ? (
        <p className="flex items-center gap-1.5 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
          <Check className="h-3 w-3 shrink-0" />
          Thank you
        </p>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={onClaim}
          className="group inline-flex cursor-pointer items-center gap-1.5 border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
        >
          {label}
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      )}
    </div>
  );
}

export function CommunityBonusStep() {
  const appState = useQuery(api.userAppState.getMyAppState);
  const claimGithubStarBonus = useMutation(api.userAppState.claimGithubStarBonus);
  const claimDiscordBonus = useMutation(api.userAppState.claimDiscordBonus);
  const claimTwitterBonus = useMutation(api.userAppState.claimTwitterBonus);
  const completeCommunityScreen = useMutation(
    api.userAppState.completeCommunityScreen,
  );

  const [claimedGithub, setClaimedGithub] = useState(false);
  const [claimedDiscord, setClaimedDiscord] = useState(false);
  const [claimedTwitter, setClaimedTwitter] = useState(false);

  const githubStarBonusClaimed =
    Boolean(appState?.githubStarBonusClaimed) || claimedGithub;
  const discordBonusClaimed =
    Boolean(appState?.discordBonusClaimed) || claimedDiscord;
  const twitterBonusClaimed =
    Boolean(appState?.twitterBonusClaimed) || claimedTwitter;

  const baseTrialDays = appState?.trialDaysTotal ?? 7;
  const trialDaysTotal =
    baseTrialDays +
    (claimedGithub && !appState?.githubStarBonusClaimed ? BONUS_DAYS : 0) +
    (claimedDiscord && !appState?.discordBonusClaimed ? BONUS_DAYS : 0) +
    (claimedTwitter && !appState?.twitterBonusClaimed ? BONUS_DAYS : 0);

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
          claimed={githubStarBonusClaimed}
          href={GITHUB_REPO_URL}
          icon={<GitHubIcon className="h-3.5 w-3.5" />}
          label="Star on GitHub"
          onClaim={() => {
            setClaimedGithub(true);
            void claimGithubStarBonus({});
          }}
        />
        <BonusRow
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
        Current trial: {trialDaysTotal} day{trialDaysTotal === 1 ? "" : "s"} · optional
      </p>

      <div className="flex justify-end">
        <Link
          href="/onboarding"
          onClick={markCommunityScreenComplete}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
