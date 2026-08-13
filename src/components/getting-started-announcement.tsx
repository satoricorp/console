"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { DOCS_URL } from "@/lib/site-links";

/** Top-of-page announcement for signed-in users who have finished onboarding. */
export function GettingStartedAnnouncement() {
  const pathname = usePathname();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const authReady =
    !sessionPending &&
    !convexAuthLoading &&
    Boolean(session?.user) &&
    isAuthenticated;
  const onboardingStatus = useQuery(
    api.repos.getOnboardingStatus,
    authReady ? {} : "skip",
  );

  // The v2 landing preview carries its own branding and chrome.
  if (pathname === "/new") {
    return null;
  }

  if (!authReady || !onboardingStatus?.onboardingCompleted) {
    return null;
  }

  return (
    <div
      role="status"
      className="bg-emerald-600/90 px-6 py-2.5 text-center text-sm text-white dark:bg-emerald-700/90"
    >
      Getting Started? Go to the{" "}
      <Link
        href={DOCS_URL}
        className="font-medium underline underline-offset-2 hover:text-emerald-100"
      >
        Documentation
      </Link>{" "}
      to start using GX!
    </div>
  );
}
