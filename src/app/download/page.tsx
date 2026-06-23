import Link from "next/link";
import { AppPage } from "@/components/app-page";
import { CopyCommand } from "@/components/copy-command";
import { DownloadSeenMarker } from "@/components/download-seen-marker";
import { MacosDownloadButton } from "@/components/macos-download-button";

const INSTALL_COMMAND = "go install github.com/satoricorp/gx/cmd/gx@latest";

export default function DownloadPage() {
  return (
    <AppPage>
      <DownloadSeenMarker />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 py-4">
        <section className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              macOS
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Install the GX app
            </h1>
            <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              The macOS app installs the CLI, provides menu-bar status, and
              includes local MCP setup instructions.
            </p>
          </div>

          <MacosDownloadButton className="w-fit px-8 py-3" />
        </section>

        <section className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Linux and Windows
            </p>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Install the CLI from a terminal
            </h2>
            <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Install Go, then install the GX CLI directly from the open-source
              repository.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
              Linux, macOS, or Windows PowerShell
            </p>
            <CopyCommand command={INSTALL_COMMAND} />
          </div>

          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            If `gx` is not found after install, add Go&apos;s bin directory to
            your PATH: `~/go/bin` on Linux/macOS or `%USERPROFILE%\go\bin` on
            Windows.
          </p>
        </section>

        <Link
          href="/repositories"
          className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Continue to repositories
        </Link>
      </div>
    </AppPage>
  );
}
