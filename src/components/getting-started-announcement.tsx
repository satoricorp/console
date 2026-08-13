"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { DOCS_URL } from "@/lib/site-links";

const DISMISSED_STORAGE_KEY = "gx-getting-started-announcement-dismissed";

/** Hidden on docs (already the destination) and the self-branded /new preview. */
function isHiddenPath(pathname: string) {
  return (
    pathname === "/new" ||
    pathname === DOCS_URL ||
    pathname.startsWith(`${DOCS_URL}/`)
  );
}

/**
 * Visibility + dismissal for the getting-started banner. Lives as a hook so
 * SiteHeader can offset its fixed avatar cluster while the banner is showing.
 */
export function useGettingStartedAnnouncement() {
  const pathname = usePathname();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(DISMISSED_STORAGE_KEY) === "1",
  );
  const authReady =
    !sessionPending &&
    !convexAuthLoading &&
    Boolean(session?.user) &&
    isAuthenticated;
  const onboardingStatus = useQuery(
    api.repos.getOnboardingStatus,
    authReady ? {} : "skip",
  );

  return {
    visible:
      !dismissed &&
      !isHiddenPath(pathname) &&
      authReady &&
      Boolean(onboardingStatus?.onboardingCompleted),
    dismiss: () => {
      setDismissed(true);
      try {
        window.localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
      } catch {
        // Private-mode storage failure only costs re-showing after reload.
      }
    },
  };
}

/** Top-of-page announcement for signed-in users who have finished onboarding. */
export function GettingStartedAnnouncement({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-emerald-500 px-12 py-2.5 text-center text-sm text-white dark:bg-emerald-600"
    >
      Getting Started? Go to the{" "}
      <Link
        href={DOCS_URL}
        className="font-medium underline underline-offset-2 hover:text-emerald-100"
      >
        Documentation
      </Link>{" "}
      to start using GX!
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss announcement"
        className="absolute right-4 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center text-white/80 transition-colors hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
