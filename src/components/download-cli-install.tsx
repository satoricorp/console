"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, GitBranch } from "lucide-react";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CopyCommand } from "@/components/copy-command";
import { CLI_INSTALL_COMMAND } from "@/lib/gx-download";
import { githubSignInUrl } from "@/lib/site-links";

const AUTH_LOGIN_COMMAND = "gx auth login";

function WindowsRequest() {
  const { isAuthenticated } = useConvexAuth();
  const appState = useQuery(api.userAppState.getMyAppState);
  const requestWindowsCli = useMutation(api.userAppState.requestWindowsCli);
  const [requestedNow, setRequestedNow] = useState(false);

  const requested = requestedNow || Boolean(appState?.windowsCliRequested);

  if (requested) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
        <Check className="h-3 w-3 shrink-0" />
        Windows build requested — we&apos;ll contact you once it&apos;s live.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <p className="text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
        On Windows, run it inside WSL.
      </p>
      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => {
            setRequestedNow(true);
            void requestWindowsCli({});
          }}
          className="cursor-pointer border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-950 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:hover:border-zinc-600"
        >
          Request a native Windows build
        </button>
      ) : (
        <a
          href={githubSignInUrl("/download")}
          className="border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-950 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:hover:border-zinc-600"
        >
          Sign in to request a native Windows build
        </a>
      )}
      <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
        We&apos;ll contact you once it&apos;s live.
      </p>
    </div>
  );
}

export function DownloadCliInstall() {
  const [installCommandCopied, setInstallCommandCopied] = useState(false);

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

      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <WindowsRequest />
      </div>

      <div className="flex justify-end gap-2">
        <Link
          href="/reviews"
          className="group inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-none bg-zinc-900 px-6 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Go to Reviews
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
        {installCommandCopied ? (
          <Link
            href="/community"
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
