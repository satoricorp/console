import { api } from "../../../convex/_generated/api";
import { AppPage } from "@/components/app-page";
import {
  ReviewsList,
  type ReviewListItem,
} from "@/components/reviews/reviews-list";
import { ReviewsEmptyState } from "@/components/reviews/reviews-empty-state";
import { SignInLink } from "@/components/sign-in-link";
import { fetchAuthQuery } from "@/lib/auth-server";
import { gxApiJson } from "@/lib/gx-api-server";

export default async function ReviewsPage() {
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

  // First-time copy lives in ReviewsEmptyState. Prefer that over a dead-end
  // error when the cloud API is unreachable or misconfigured.
  let bookmarks: ReviewListItem[] = [];
  try {
    bookmarks = await gxApiJson<ReviewListItem[]>(
      viewer.id,
      "/bookmarks?include_archived=1",
    );
  } catch (error) {
    console.error("Failed to load reviews bookmarks", error);
  }

  const isEmpty = bookmarks.length === 0;

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
              ? "How to review PRs with GX"
              : "Published changes, most recent first."}
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
