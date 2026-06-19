import Link from "next/link";
import { MacosDownloadButton } from "@/components/macos-download-button";

export default function DownloadPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-stretch gap-5">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-medium text-zinc-950 dark:text-zinc-50">
            Download GX for macOS
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Install the desktop app and start reviewing stacks locally.
          </p>
        </div>

        <MacosDownloadButton className="w-full px-8 py-3" />

        <p className="text-center text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            3 full-stack reviews free.
          </span>{" "}
          No credit card until you upgrade in the app.
        </p>

        <Link
          href="/"
          className="text-center text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-100"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
