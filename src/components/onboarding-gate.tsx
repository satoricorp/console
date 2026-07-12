"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { withOnboardingParam } from "@/lib/site-links";

const ONBOARDING_PATH = "/onboarding";
const ONBOARDING_START_PATH = "/download";
const POST_ONBOARDING_PATH = "/reviews";

/** Soft funnel steps shown once after first login. */
const ONBOARDING_FUNNEL_PATHS = [
  "/download",
  "/install-github",
  "/community",
  "/onboarding",
];

/** Routes reachable before repo connect. */
const ONBOARDING_BYPASS_PATHS = [
  "/billing",
  "/community",
  "/design",
  "/docs",
  "/download",
  "/install-github",
  "/repositories",
];

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isFunnelPath(pathname: string) {
  return ONBOARDING_FUNNEL_PATHS.some((path) => matchesPath(pathname, path));
}

function bypassesOnboarding(pathname: string) {
  return ONBOARDING_BYPASS_PATHS.some((path) => matchesPath(pathname, path));
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forceOnboarding = searchParams.get("onboarding") === "1";
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
  const onFunnelPath = isFunnelPath(pathname);
  const onboardingCompleted = Boolean(onboardingStatus?.onboardingCompleted);
  const needsRepoConnect =
    Boolean(session?.user) &&
    onboardingStatus !== undefined &&
    onboardingStatus !== null &&
    !onboardingStatus.hasConnectedRepos;
  const shouldLeaveCompletedFunnel =
    onboardingCompleted && onFunnelPath && !forceOnboarding;
  const shouldStartForcedOnboarding =
    forceOnboarding && onboardingCompleted && !onFunnelPath;

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

    if (shouldStartForcedOnboarding) {
      router.replace(withOnboardingParam(ONBOARDING_START_PATH, true));
      return;
    }

    if (shouldLeaveCompletedFunnel) {
      router.replace(POST_ONBOARDING_PATH);
      return;
    }

    if (
      !onboardingStatus.hasConnectedRepos &&
      !isOnboardingRoute &&
      !skipOnboardingRedirect
    ) {
      router.replace(
        forceOnboarding
          ? withOnboardingParam(ONBOARDING_PATH, true)
          : ONBOARDING_PATH,
      );
      return;
    }
  }, [
    authReady,
    onboardingStatus,
    isOnboardingRoute,
    skipOnboardingRedirect,
    shouldLeaveCompletedFunnel,
    shouldStartForcedOnboarding,
    forceOnboarding,
    session?.user,
    sessionPending,
    convexAuthLoading,
    router,
  ]);

  if (sessionPending) {
    return <OnboardingGateFallback />;
  }

  if (session?.user && convexAuthLoading && !skipOnboardingRedirect) {
    return <OnboardingGateFallback />;
  }

  if (!session?.user && isOnboardingRoute) {
    return <OnboardingGateFallback />;
  }

  if (
    session?.user &&
    !skipOnboardingRedirect &&
    (!isAuthenticated || onboardingStatus === undefined)
  ) {
    return <OnboardingGateFallback />;
  }

  if (shouldLeaveCompletedFunnel || shouldStartForcedOnboarding) {
    return <OnboardingGateFallback />;
  }

  if (needsRepoConnect && !isOnboardingRoute && !skipOnboardingRedirect) {
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
