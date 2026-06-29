"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { DiscordIcon } from "@/components/discord-icon";
import { GitHubIcon } from "@/components/github-icon";
import { DISCORD_URL, GITHUB_REPO_URL } from "@/lib/site-links";
import { cn } from "@/lib/utils";

function BonusCard({
  claimed,
  bonusDays,
  description,
  href,
  icon,
  label,
  onClaim,
}: {
  claimed: boolean;
  bonusDays: number;
  description: string;
  href: string;
  icon: ReactNode;
  label: string;
  onClaim: () => void;
}) {
  function handleClick() {
    if (!claimed) {
      onClaim();
    }
  }

  return (
    <section className="space-y-4 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-zinc-950 dark:text-zinc-50">{icon}</div>
          <div className="space-y-1">
            <h2 className="text-base font-medium text-zinc-950 dark:text-zinc-50">
              {label}
            </h2>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {description}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
          +{bonusDays} days
        </span>
      </div>

      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        className={cn(
          "inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-none px-8 py-2.5 text-sm font-medium transition-colors sm:min-w-44 sm:w-auto",
          claimed
            ? "border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
        )}
      >
        {claimed ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Bonus added
          </>
        ) : (
          <>
            {label}
            <ExternalLink className="h-4 w-4" />
          </>
        )}
      </a>
    </section>
  );
}

export function CommunityBonusStep() {
  const router = useRouter();
  const appState = useQuery(api.userAppState.getMyAppState);
  const claimGithubStarBonus = useMutation(api.userAppState.claimGithubStarBonus);
  const claimDiscordBonus = useMutation(api.userAppState.claimDiscordBonus);
  const completeCommunityScreen = useMutation(
    api.userAppState.completeCommunityScreen,
  );

  const trialDaysTotal = appState?.trialDaysTotal ?? 7;
  const githubStarBonusDays = appState?.githubStarBonusDays ?? 3;
  const discordBonusDays = appState?.discordBonusDays ?? 3;

  async function continueToRepositories() {
    await completeCommunityScreen({});
    router.push("/onboarding");
  }

  if (appState === undefined || appState === null) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
          Extend your trial
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Get 6 more days free
        </h1>
        <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Star the GX repo and join our Discord to add 3 days each.
        </p>
        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          Current trial: {trialDaysTotal} day{trialDaysTotal === 1 ? "" : "s"}
        </p>
      </div>

      <div className="space-y-4">
        <BonusCard
          claimed={appState.githubStarBonusClaimed}
          bonusDays={githubStarBonusDays}
          description="Help others discover GX."
          href={GITHUB_REPO_URL}
          icon={<GitHubIcon className="h-5 w-5" />}
          label="Star on GitHub"
          onClaim={() => {
            void claimGithubStarBonus({});
          }}
        />

        <BonusCard
          claimed={appState.discordBonusClaimed}
          bonusDays={discordBonusDays}
          description="Get help, share feedback, and meet other GX users."
          href={DISCORD_URL}
          icon={<DiscordIcon className="h-5 w-5" />}
          label="Join Discord"
          onClaim={() => {
            void claimDiscordBonus({});
          }}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <p className="max-w-xs text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:mr-auto">
          Bonuses are optional. Continue when you&apos;re ready to connect repos.
        </p>
        <button
          type="button"
          onClick={() => {
            void continueToRepositories();
          }}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-none bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Connect repositories
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
