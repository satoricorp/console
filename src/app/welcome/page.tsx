"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { POST_SIGN_IN_URL } from "@/lib/site-links";

export default function WelcomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace("/");
      return;
    }

    router.replace(POST_SIGN_IN_URL);
  }, [isAuthenticated, isLoading, router]);

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
