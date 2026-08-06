import { api } from "../../../convex/_generated/api";
import { AppPage } from "@/components/app-page";
import {
  ReviewsList,
  type ReviewListItem,
} from "@/components/reviews/reviews-list";
import { ReviewsEmptyState } from "@/components/reviews/reviews-empty-state";
import { SignInLink } from "@/components/sign-in-link";
import { fetchAuthQuery } from "@/lib/auth-server";
import { DEMO_REVIEW_LIST } from "@/lib/demo-review";
import { gxApiJson } from "@/lib/gx-api-server";

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  const demoMode = (await searchParams).demo === "1";
  if (demoMode) {
    return (
      <AppPage>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Reviews
            </h1>
            <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
              Published changes, grouped by repository.
            </p>
          </div>
          <ReviewsList initialBookmarks={DEMO_REVIEW_LIST} demoMode />
        </div>
      </AppPage>
    );
  }

  const viewer = await fetchAuthQuery(api.profile.getViewer, {});

  if (!viewer?.id) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          Sign in to see your reviews
        </h1>
        <p className="mt-4 text-sm">
          <SignInLink
            className="underline underline-offset-2"
            callbackURL="/reviews"
          />{" "}
          with GitHub to continue.
        </p>
      </main>
    );
  }

  // Default list is open (non-archived). If that is empty, probe for any
  // bookmark so we still show the filter UI when the user only has
  // merged/closed/archived reviews — instead of the first-run empty state.
  let bookmarks: ReviewListItem[] = [];
  let isEmpty = true;
  try {
    bookmarks = await gxApiJson<ReviewListItem[]>(
      viewer.id,
      "/v1/reviews?merge_status=open&github_pr_only=1",
    );
    if (bookmarks.length > 0) {
      isEmpty = false;
    } else {
      const any = await gxApiJson<ReviewListItem[]>(
        viewer.id,
        "/v1/reviews?include_archived=1",
      );
      isEmpty = any.length === 0;
    }
  } catch (error) {
    console.error("Failed to load reviews bookmarks", error);
  }

  return (
    <AppPage>
      <div
        className={`mx-auto flex w-full flex-col gap-4 py-4 ${
          isEmpty ? "max-w-[860px]" : "max-w-xl"
        }`}
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Reviews
          </h1>
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            {isEmpty
              ? "How to review PRs with gx"
              : "Published changes, grouped by repository."}
          </p>
        </div>

        {isEmpty ? (
          <ReviewsEmptyState />
        ) : (
          <ReviewsList initialBookmarks={bookmarks} />
        )}
      </div>
    </AppPage>
  );
}
