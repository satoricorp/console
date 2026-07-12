"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, RefreshCw } from "lucide-react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { GitHubIcon } from "@/components/github-icon";
import { withOnboardingParam } from "@/lib/site-links";

export function InstallGithubAppStep() {
  const searchParams = useSearchParams();
  const forceOnboarding = searchParams.get("onboarding") === "1";
  const { isAuthenticated } = useConvexAuth();
  const getStatus = useAction(api.githubAppInstall.getGithubAppInstallStatus);
  const completeScreen = useMutation(
    api.userAppState.completeGithubAppInstallScreen,
  );

  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isAuthenticated) return;
    setChecking(true);
    try {
      const status = await getStatus({});
      setInstallUrl(status.installUrl);
      setInstalled(status.installed);
      setChecked(status.checked);
    } catch (error: unknown) {
      console.error("Failed to check GitHub App install status", error);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, [getStatus, isAuthenticated]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  function markComplete() {
    void completeScreen({}).catch((error: unknown) => {
      console.error("Failed to complete GitHub App install screen", error);
    });
  }

  if (loading) {
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
      <div className="space-y-2">
        <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
          Install the GX GitHub App on your personal account or org so reviews
          and CLI auth can run against your repositories.
        </p>
        {installed ? (
          <p className="flex items-center gap-1.5 text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            <Check className="h-3.5 w-3.5 shrink-0 text-zinc-950 dark:text-zinc-50" />
            GX is installed on at least one of your GitHub accounts.
          </p>
        ) : (
          <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
            After installing, return here and continue. Membership syncs from
            the install webhook.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {installUrl ? (
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex cursor-pointer items-center gap-1.5 border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
          >
            <GitHubIcon className="h-3.5 w-3.5" />
            {installed ? "Manage install on GitHub" : "Install GX on GitHub"}
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        ) : null}

        {checked && !installed ? (
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={checking}
            className="inline-flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            <RefreshCw
              className={`h-3 w-3 ${checking ? "animate-spin" : ""}`}
            />
            Check again
          </button>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Link
          href={withOnboardingParam("/onboarding", forceOnboarding)}
          onClick={markComplete}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
