"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const eventId = params.id ?? "";
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const bookmarkId = useQuery(
    api.gxPr.getBookmarkIdForEvent,
    session?.user && eventId ? { eventId } : "skip",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bookmarkId === undefined) {
      return;
    }
    if (bookmarkId === null) {
      setError("Bookmark not found for this review. Run gx pr again to sync it.");
      return;
    }
    router.replace(`/?bookmark=${encodeURIComponent(bookmarkId)}`);
  }, [bookmarkId, router]);

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
      {bookmarkId === undefined ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Resolving bookmark…
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </main>
  );
}
