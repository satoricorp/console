"use client";

import { ConnectReposStep } from "@/components/onboarding/connect-repos-step";

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col px-6 py-12">
      <ConnectReposStep />
    </main>
  );
}
