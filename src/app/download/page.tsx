import type { ReactNode } from "react";
import { ChevronDown, Terminal } from "lucide-react";
import { AppPage } from "@/components/app-page";
import { AppleIcon } from "@/components/apple-icon";
import { CopyCommand } from "@/components/copy-command";
import { DownloadSeenMarker } from "@/components/download-seen-marker";
import { MacosDownloadButton } from "@/components/macos-download-button";
import {
  CLI_INSTALL_COMMAND,
  MACOS_DOWNLOAD_ZIP_URL,
} from "@/lib/gx-download";

type PlatformSectionProps = {
  icon: ReactNode;
  platform: string;
  title: string;
  description: string;
  children: ReactNode;
};

function PlatformSection({
  icon,
  platform,
  title,
  description,
  children,
}: PlatformSectionProps) {
  return (
    <section className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-zinc-200 bg-white text-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50">
          {icon}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            {platform}
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {title}
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {description}
          </p>
        </div>
      </div>
      <div className="space-y-8 p-5">{children}</div>
    </section>
  );
}

export default function DownloadPage() {
  return (
    <AppPage>
      <DownloadSeenMarker />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Install GX
          </h1>
          <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Choose your platform below.
          </p>
        </div>

        <PlatformSection
          icon={<AppleIcon className="h-5 w-5" />}
          platform="macOS"
          title="Install"
          description="The macOS app installs the CLI, provides menu-bar status, and includes local MCP setup instructions."
        >
          <div className="space-y-3">
            <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
              Desktop{" "}
              <span className="font-normal text-[var(--footer-link-hover)]">
                (Recommended)
              </span>
            </p>
            <MacosDownloadButton className="w-fit px-8 py-3" />
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Having trouble with the DMG?{" "}
              <a
                href={MACOS_DOWNLOAD_ZIP_URL}
                className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-700 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:text-zinc-300"
              >
                Download the ZIP instead
              </a>
              .
            </p>
          </div>

          <details className="group border-t border-zinc-200 dark:border-zinc-800">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-sm font-medium text-zinc-950 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
              CLI (only required if not downloading the macOS desktop app)
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="pb-1">
              <CopyCommand command={CLI_INSTALL_COMMAND} />
            </div>
          </details>
        </PlatformSection>

        <PlatformSection
          icon={<Terminal className="h-5 w-5" strokeWidth={1.75} />}
          platform="Linux"
          title="Install"
          description="Run the install script to download and install the GX CLI."
        >
          <CopyCommand command={CLI_INSTALL_COMMAND} />
        </PlatformSection>
      </div>
    </AppPage>
  );
}
