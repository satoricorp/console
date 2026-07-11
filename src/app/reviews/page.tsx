import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { AppPage } from "@/components/app-page";
import { SignInLink } from "@/components/sign-in-link";
import { fetchAuthQuery } from "@/lib/auth-server";
import { gxApiJson } from "@/lib/gx-api-server";

type BookmarkListItem = {
  id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  merge_status: "open" | "merged" | "closed";
  updated_at_ms: number;
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

  let bookmarks: BookmarkListItem[] | null = null;
  try {
    bookmarks = await gxApiJson<BookmarkListItem[]>(viewer.id, "/bookmarks");
  } catch {
    bookmarks = null;
  }

  return (
    <AppPage>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Reviews
          </h1>
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            Published changes, most recent first.
          </p>
        </div>

        {bookmarks === null ? (
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            Couldn&apos;t load reviews. Try again in a moment.
          </p>
        ) : bookmarks.length === 0 ? (
          <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
            No reviews yet. Publish a change with{" "}
            <code className="font-mono text-xs">gx pr</code> and it will show
            up here.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id}>
                <Link
                  href={`/reviews/${bookmark.id}`}
                  className="flex items-baseline justify-between gap-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium leading-5 text-zinc-950 dark:text-zinc-50">
                      {bookmark.title ?? bookmark.branch_name}
                    </span>
                    <span className="block truncate text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
                      {bookmark.repo_full_name} · {bookmark.branch_name}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
                    {bookmark.merge_status}
                    <span className="block">
                      {formatDate(bookmark.updated_at_ms)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppPage>
  );
}
