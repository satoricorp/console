import { Suspense } from "react";
import { AppPage } from "@/components/app-page";
import { DownloadCliInstall } from "@/components/download-cli-install";
import { DownloadSeenMarker } from "@/components/download-seen-marker";

export default function DownloadPage() {
  return (
    <AppPage>
      <DownloadSeenMarker />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Install
          </h1>
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            Run the install script, then log in from your terminal.
          </p>
        </div>

        <Suspense fallback={null}>
          <DownloadCliInstall />
        </Suspense>
      </div>
    </AppPage>
  );
}
