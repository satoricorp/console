import { Suspense } from "react";
import { AppPage } from "@/components/app-page";
import { InstallGithubAppStep } from "@/components/onboarding/install-github-app-step";

export default function InstallGithubPage() {
  return (
    <AppPage>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Install on GitHub
          </h1>
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            Connect the GX GitHub App so org membership and reviews work.
          </p>
        </div>

        <Suspense fallback={null}>
          <InstallGithubAppStep />
        </Suspense>
      </div>
    </AppPage>
  );
}
