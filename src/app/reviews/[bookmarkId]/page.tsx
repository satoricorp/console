import { api } from "../../../../convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { gxApiJson } from "@/lib/gx-api-server";
import type { ReviewResponse } from "@/lib/reviews-client";
import { ReviewView } from "./review-view";
import { SignInLink } from "@/components/sign-in-link";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ bookmarkId: string }>;
}) {
  const { bookmarkId } = await params;
  const viewer = await fetchAuthQuery(api.profile.getViewer, {});

  if (!viewer?.id) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Sign in to review
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          GX review pages are private to the publisher and their org.
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
