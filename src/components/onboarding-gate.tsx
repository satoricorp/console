"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";

const ONBOARDING_PATH = "/onboarding";

/** Routes reachable before repo connect. */
const ONBOARDING_BYPASS_PATHS = [
  "/billing",
  "/community",
  "/design",
  "/docs",
  "/download",
  "/repositories",
];

function bypassesOnboarding(pathname: string) {
  return ONBOARDING_BYPASS_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const authReady =
    !sessionPending && !convexAuthLoading && Boolean(session?.user) && isAuthenticated;
  const onboardingStatus = useQuery(
    api.repos.getOnboardingStatus,
    authReady ? {} : "skip",
  );

  const isOnboardingRoute = pathname === ONBOARDING_PATH;
  const skipOnboardingRedirect = bypassesOnboarding(pathname);
  const needsOnboarding =
    Boolean(session?.user) &&
    onboardingStatus !== undefined &&
    onboardingStatus !== null &&
    !onboardingStatus.hasConnectedRepos;

  useEffect(() => {
    if (!sessionPending && !convexAuthLoading && !session?.user) {
      if (isOnboardingRoute) {
        router.replace("/");
      }
      return;
    }

    if (!authReady || onboardingStatus === undefined) {
      return;
    }

    if (onboardingStatus === null) return;

    if (
      !onboardingStatus.hasConnectedRepos &&
      !isOnboardingRoute &&
      !skipOnboardingRedirect
    ) {
      router.replace(ONBOARDING_PATH);
      return;
    }
  }, [
    authReady,
    onboardingStatus,
    isOnboardingRoute,
    skipOnboardingRedirect,
    session?.user,
    sessionPending,
    convexAuthLoading,
    router,
  ]);

  if (sessionPending) {
    return <OnboardingGateFallback />;
  }

  if (session?.user && convexAuthLoading) {
    return <OnboardingGateFallback />;
  }

  if (!session?.user && isOnboardingRoute) {
    return <OnboardingGateFallback />;
  }

  if (session?.user && (!isAuthenticated || onboardingStatus === undefined)) {
    return <OnboardingGateFallback />;
  }

  if (needsOnboarding && !isOnboardingRoute && !skipOnboardingRedirect) {
    return <OnboardingGateFallback />;
  }

  return children;
}

function OnboardingGateFallback() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
