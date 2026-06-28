"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Settings,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { AppleIcon } from "@/components/apple-icon";
import { CopyCommand } from "@/components/copy-command";
import { CLI_INSTALL_COMMAND, MACOS_DOWNLOAD_URL } from "@/lib/gx-download";
import { cn } from "@/lib/utils";

type Platform = "macos" | "linux";

const MACOS_PRIVACY_SECURITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension";

function ChooseRepositoriesLink() {
  return (
    <Link
      href="/onboarding"
      className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:w-fit dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      <GitBranch className="h-4 w-4" />
      Choose Repositories Next
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function PlatformRadio({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-16 flex-1 items-center justify-between border px-4 py-3 text-left transition-colors",
        active
          ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
          : "border-zinc-200 bg-white text-zinc-950 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:border-zinc-600",
      )}
    >
      <span className="flex items-center gap-3">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </span>
      {active ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}

function MacosInstructions() {
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [privacySettingsOpened, setPrivacySettingsOpened] = useState(false);

  return (
    <div className="space-y-4">
      <section className="space-y-5 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        {downloadStarted ? (
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
            <div className="space-y-3">
              <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Allow GX in System Settings.
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <li>Open System Settings.</li>
                <li>Go to Privacy & Security.</li>
                <li>Choose &apos;Open Anyway&apos;.</li>
              </ol>
              <a
                href={MACOS_PRIVACY_SECURITY_SETTINGS_URL}
                onClick={() => setPrivacySettingsOpened(true)}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:w-fit dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <Settings className="h-4 w-4" />
                Open Privacy & Security
              </a>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Install for macOS
              </h2>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <li>Installs the desktop app.</li>
                <li>Installs the CLI.</li>
                <li>Includes local MCP setup instructions.</li>
              </ul>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setDownloadStarted(true);
                  setPrivacySettingsOpened(false);
                  window.location.href = MACOS_DOWNLOAD_URL;
                }}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:w-fit dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <AppleIcon className="h-4 w-4" />
                Download for macOS
              </button>
            </div>
          </>
        )}
      </section>

      {privacySettingsOpened ? (
        <div className="flex justify-end">
          <ChooseRepositoriesLink />
        </div>
      ) : null}
    </div>
  );
}

function LinuxInstructions() {
  const [commandCopied, setCommandCopied] = useState(false);

  return (
    <div className="space-y-4">
      <section className="space-y-5 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Install for Linux
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Run the install script to download and install the GX CLI.
          </p>
        </div>

        <CopyCommand
          command={CLI_INSTALL_COMMAND}
          onCopy={() => setCommandCopied(true)}
        />
      </section>

      {commandCopied ? (
        <div className="flex justify-end">
          <ChooseRepositoriesLink />
        </div>
      ) : null}
    </div>
  );
}

export function DownloadPlatformChooser() {
  const [platform, setPlatform] = useState<Platform | null>(null);

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Choose platform" className="flex gap-3">
        <PlatformRadio
          active={platform === "macos"}
          icon={<AppleIcon className="h-5 w-5" />}
          label="MacOS"
          onClick={() => setPlatform("macos")}
        />
        <PlatformRadio
          active={platform === "linux"}
          icon={<Terminal className="h-5 w-5" strokeWidth={1.75} />}
          label="Linux"
          onClick={() => setPlatform("linux")}
        />
      </div>

      {platform === "macos" ? <MacosInstructions /> : null}
      {platform === "linux" ? <LinuxInstructions /> : null}
    </div>
  );
}
