"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";
import { GxLogo } from "@/components/gx-logo";

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const stripeBilling = useQuery(
    api.billing.getMyStripeBilling,
    session?.user ? {} : "skip",
  );
  const hasActiveSubscription = stripeBilling?.subscription?.isActive ?? false;
  const billingLoading = Boolean(session?.user) && stripeBilling === undefined;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        {isPending ? (
          <div className="h-20 w-64 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        ) : session?.user ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Welcome back
                {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Use the menu in the header to view your profile or sign out.
              </p>
            </div>

            {billingLoading ? (
              <div className="h-10 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            ) : hasActiveSubscription ? (
              <Link
                href="/billing"
                className="text-sm font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
              >
                Manage billing
              </Link>
            ) : (
              <div className="space-y-2">
                <Button fullWidth onClick={() => router.push("/billing")}>
                  Start 14-day free trial
                </Button>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Then $28/month. Card required; no charge until trial ends.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <GxLogo variant="hero" className="mx-auto" />
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Welcome
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Sign in with GitHub to get started. Your profile appears in the
                header once you are authenticated.
              </p>
            </div>
            <AuthButton />
          </>
        )}
      </div>
    </main>
  );
}
