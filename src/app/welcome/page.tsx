"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function WelcomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const appState = useQuery(
    api.userAppState.getMyAppState,
    isAuthenticated ? {} : "skip",
  );

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace("/");
      return;
    }

    if (appState === undefined) return;

    router.replace(
      appState?.downloadScreenCompleted === true ? "/repositories" : "/download",
    );
  }, [appState, isAuthenticated, isLoading, router]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
