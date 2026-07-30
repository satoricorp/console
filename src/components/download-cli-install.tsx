"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, GitBranch } from "lucide-react";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CopyCommand } from "@/components/copy-command";
import { CLI_INSTALL_COMMAND } from "@/lib/tx-download";
import { githubSignInUrl, withOnboardingParam } from "@/lib/site-links";

const AUTH_LOGIN_COMMAND = "tx auth login";
const INIT_COMMAND = "tx init";

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M0 2.275 6.545.75v6.182H0zm7.273-.455L16 0v6.932H7.273zM0 8.91h6.545v6.34L0 13.91zm7.273.113H16V16l-8.727-1.227z" />
    </svg>
  );
}

function WindowsRequest() {
  const { isAuthenticated } = useConvexAuth();
  const appState = useQuery(api.userAppState.getMyAppState);
  const requestWindowsCli = useMutation(api.userAppState.requestWindowsCli);
  const [requestedNow, setRequestedNow] = useState(false);

  const requested = requestedNow || Boolean(appState?.windowsCliRequested);

  if (requested) {
    return (
      <p className="text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
        We&apos;ll reach out to you once we have a live Windows build
      </p>
    );
  }

  const buttonClassName =
    "group inline-flex cursor-pointer items-center gap-1.5 border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100";

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="flex items-center gap-1.5 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
        <WindowsIcon className="h-3 w-3 shrink-0 text-zinc-950 dark:text-white" />
        Run TX inside WSL (for Windows).
      </p>
      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => {
            setRequestedNow(true);
            void requestWindowsCli({});
          }}
          className={buttonClassName}
        >
          Click to request a native Windows build
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </button>
      ) : (
        <a href={githubSignInUrl("/download")} className={buttonClassName}>
          Click to request a native Windows build
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      )}
    </div>
  );
}

export function DownloadCliInstall() {
  const [installCommandCopied, setInstallCommandCopied] = useState(false);
  const searchParams = useSearchParams();
  const forceOnboarding = searchParams.get("onboarding") === "1";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <CopyCommand
          command={CLI_INSTALL_COMMAND}
          onCopy={() => setInstallCommandCopied(true)}
        />
        <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
          macOS (darwin) / Linux · arm64 / amd64
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
          Then log in:
        </p>
        <CopyCommand command={AUTH_LOGIN_COMMAND} />
      </div>

      <div className="space-y-1.5">
        <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
          Then run once inside each repository:
        </p>
        <CopyCommand command={INIT_COMMAND} />
        <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
          Installs the Git hooks — keep using plain git commit and git push.
        </p>
      </div>

      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <WindowsRequest />
      </div>

      <div className="flex justify-end">
        {installCommandCopied ? (
          <Link
            href={withOnboardingParam("/install-github", forceOnboarding)}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-none bg-zinc-200 px-3.5 py-2 text-[13px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
