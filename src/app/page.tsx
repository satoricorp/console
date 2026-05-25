"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";
import { GxLogo } from "@/components/gx-logo";
import { PrCard } from "@/components/pr-card";
import { PrDebugDrawer } from "@/components/pr-debug-drawer";

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const [selectedPrId, setSelectedPrId] = useState<Id<"gxPullRequests"> | null>(
    null,
  );
  const stripeBilling = useQuery(
    api.billing.getMyStripeBilling,
    session?.user ? {} : "skip",
  );
  const gxPullRequests = useQuery(
    api.gxPullRequests.listMine,
    session?.user ? {} : "skip",
  );
  const hasActiveSubscription = stripeBilling?.subscription?.isActive ?? false;
  const billingLoading = Boolean(session?.user) && stripeBilling === undefined;
  const prsLoading = Boolean(session?.user) && gxPullRequests === undefined;
  const debugEnabled =
    process.env.NEXT_PUBLIC_GX_DEBUG === "true" ||
    searchParams.get("debug") === "gx";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-5xl flex-col items-center gap-8 text-center">
        {isPending ? (
          <div className="h-20 w-64 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        ) : session?.user ? (
          <div className="w-full space-y-8">
            <div className="mx-auto max-w-md space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Welcome back
                {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Use the menu in the header to view your profile or sign out.
              </p>
            </div>

            <section className="w-full space-y-4 text-left">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Pull requests
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Recent `gx pr` submissions saved for your account.
                  </p>
                </div>
                {debugEnabled ? (
                  <span className="w-fit border border-amber-500/40 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-200">
                    Debug mode
                  </span>
                ) : null}
              </div>

              {prsLoading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-32 animate-pulse border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  ))}
                </div>
              ) : gxPullRequests && gxPullRequests.length > 0 ? (
                <div className="grid gap-3">
                  {gxPullRequests.map((pr) => (
                    <PrCard
                      key={pr.id}
                      pr={pr}
                      debugEnabled={debugEnabled}
                      onInspect={setSelectedPrId}
                    />
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  No PR cards yet. Run `gx pr` from a connected repository to
                  create one here.
                </div>
              )}
            </section>

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

            <PrDebugDrawer
              prId={selectedPrId}
              open={selectedPrId !== null}
              onOpenChange={(open) => {
                if (!open) setSelectedPrId(null);
              }}
            />
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
