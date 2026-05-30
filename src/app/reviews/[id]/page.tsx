"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { fetchBookmarkIdByEvent } from "@/lib/bookmarks-client";
import { AuthButton } from "@/components/auth-button";

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reviewId = params.id ?? "";
  const { data: session, isPending: sessionPending } = authClient.useSession();

  useEffect(() => {
    if (!session?.user || !reviewId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const byEvent = await fetchBookmarkIdByEvent(reviewId);
        if (cancelled) return;
        router.replace(`/?bookmark=${encodeURIComponent(byEvent ?? reviewId)}`);
      } catch {
        if (!cancelled) {
          router.replace(`/?bookmark=${encodeURIComponent(reviewId)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reviewId, router, session?.user]);

  if (sessionPending) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-12">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-start gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to view this GX review.
        </p>
        <AuthButton />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">GX Review</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Opening review…</p>
    </main>
  );
}
