import { notFound } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { getDemoReview } from "@/lib/demo-review";
import { REVIEWS_ENABLED } from "@/lib/feature-flags";
import { gxApiJson } from "@/lib/gx-api-server";
import type { ReviewResponse } from "@/lib/reviews-client";
import { ReviewView } from "./review-view";
import { SignInLink } from "@/components/sign-in-link";

// notFound() thrown during metadata resolution happens before the layout's
// Suspense shell flushes, so the response carries a real 404 status; the same
// throw inside the page body would stream the 404 UI under HTTP 200.
export function generateMetadata() {
  if (!REVIEWS_ENABLED) notFound();
  return {};
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookmarkId: string }>;
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  if (!REVIEWS_ENABLED) notFound();

  const { bookmarkId } = await params;
  const demoMode = (await searchParams).demo === "1";
  if (demoMode) {
    return (
      <ReviewView
        bookmarkId={bookmarkId}
        initial={getDemoReview(bookmarkId)}
        demoMode
      />
    );
  }

  const viewer = await fetchAuthQuery(api.profile.getViewer, {});

  if (!viewer?.id) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Sign in to review
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          gx review pages are private to the publisher and their org.
        </p>
        <p className="mt-4 text-sm">
          <SignInLink className="underline underline-offset-2" /> with GitHub to
          continue.
        </p>
      </main>
    );
  }

  let initial: ReviewResponse | null = null;
  try {
    initial = await gxApiJson<ReviewResponse>(
      viewer.id,
      `/v1/reviews/${bookmarkId}`,
    );
  } catch {
    initial = null;
  }

  return <ReviewView bookmarkId={bookmarkId} initial={initial} />;
}
