import { AppPage } from "@/components/app-page";
import { DownloadPlatformChooser } from "@/components/download-platform-chooser";
import { DownloadSeenMarker } from "@/components/download-seen-marker";

export default function DownloadPage() {
  return (
    <AppPage>
      <DownloadSeenMarker />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Install
          </h1>
          <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Choose your platform to continue.
          </p>
        </div>

        <DownloadPlatformChooser />
      </div>
    </AppPage>
  );
}
