"use client";

import { authClient } from "@/lib/auth-client";
import { GxLogo } from "@/components/gx-logo";
import { PrConsole } from "@/components/pr/pr-console";
import { WaitlistForm } from "@/components/waitlist-form";

export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="h-20 w-64 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </main>
    );
  }

  if (session?.user) {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center">
        <PrConsole />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <GxLogo variant="hero" className="mx-auto" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Join the waitlist
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Be first to try Console. We&apos;ll email you when access opens.
          </p>
        </div>
        <WaitlistForm />
      </div>
    </main>
  );
}
