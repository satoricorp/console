"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, RefreshCw } from "lucide-react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { GitHubIcon } from "@/components/github-icon";
import { withOnboardingParam } from "@/lib/site-links";

const FALLBACK_INSTALL_URL = "https://github.com/apps/satoricorp-gx";

export function InstallGithubAppStep() {
  const searchParams = useSearchParams();
  const forceOnboarding = searchParams.get("onboarding") === "1";
  const { isAuthenticated } = useConvexAuth();
  const getStatus = useAction(api.githubAppInstall.getGithubAppInstallStatus);
  const completeScreen = useMutation(
    api.userAppState.completeGithubAppInstallScreen,
  );

  const [installUrl, setInstallUrl] = useState(FALLBACK_INSTALL_URL);
  const [installed, setInstalled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setChecking(true);
    try {
      const status = await getStatus({});
      setInstallUrl(status.installUrl || FALLBACK_INSTALL_URL);
      setInstalled(status.installed);
      setChecked(status.checked);
    } catch (error: unknown) {
      console.error("Failed to check GitHub App install status", error);
      setInstallUrl(FALLBACK_INSTALL_URL);
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
      <ol className="list-decimal space-y-2 pl-4 text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
        <li>Click the button below to open GitHub.</li>
        <li>Choose your personal account or an organization.</li>
        <li>Install the gx app, then come back here and continue.</li>
      </ol>

      {installed ? (
        <p className="flex items-center gap-1.5 text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
          <Check className="h-3.5 w-3.5 shrink-0 text-zinc-950 dark:text-zinc-50" />
          gx is installed on at least one of your GitHub accounts.
        </p>
      ) : null}

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <GitHubIcon className="h-3.5 w-3.5" />
            {installed ? "Manage on GitHub" : "Install gx on GitHub"}
          </a>

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

        <Link
          href={withOnboardingParam("/community", forceOnboarding)}
          onClick={markComplete}
          className="inline-flex cursor-pointer items-center justify-center gap-2 self-end rounded-none border border-zinc-200 bg-white px-3.5 py-2 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
