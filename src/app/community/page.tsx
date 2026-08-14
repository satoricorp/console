import { Suspense } from "react";
import { AppPage } from "@/components/app-page";
import { CommunityBonusStep } from "@/components/onboarding/community-bonus-step";

export default function CommunityPage() {
  return (
    <AppPage>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Extend trial
          </h1>
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            Join Discord or follow @satori_corp for +2 days each.
          </p>
        </div>

        <Suspense fallback={null}>
          <CommunityBonusStep />
        </Suspense>
      </div>
    </AppPage>
  );
}
