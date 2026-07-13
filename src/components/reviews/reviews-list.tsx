"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, ChevronDown, Filter } from "lucide-react";

export type ReviewListItem = {
  id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  merge_status: "open" | "merged" | "closed" | string;
  updated_at_ms: number;
  github_pr_url: string | null;
  github_pr_number: number | null;
  latest_event_id: string | null;
  file_count: number;
  archived_at_ms: number | null;
  plan_status: string | null;
  plan_error: string | null;
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function displayTitle(bookmark: ReviewListItem) {
  const title = bookmark.title?.trim();
  if (!title || title.toLowerCase() === "unknown") {
    return bookmark.branch_name;
  }
  return title;
}

/** True when GX published evidence for this bookmark (not webhook-only junk). */
export function isGxSupportedReview(bookmark: ReviewListItem) {
  return Boolean(bookmark.latest_event_id);
}

/** Reviews where GX has nothing useful to show in the main list. */
export function isNoDataReview(bookmark: ReviewListItem) {
  if (!isGxSupportedReview(bookmark)) {
    return true;
  }
  if (bookmark.plan_status !== "failed") return false;
  return (
    bookmark.plan_error === "no_surviving_changes" || bookmark.file_count === 0
  );
}

export function isMergedReview(bookmark: ReviewListItem) {
  return bookmark.merge_status === "merged";
}

/** Partition bookmarks for the reviews list (merged hidden by default). */
export function partitionReviewsList(
  bookmarks: ReviewListItem[],
  opts: { showArchived: boolean; showMerged: boolean },
) {
  const noDataItems: ReviewListItem[] = [];
  const main: ReviewListItem[] = [];
  let archived = 0;
  let merged = 0;

  for (const bookmark of bookmarks) {
    if (isMergedReview(bookmark)) {
      merged += 1;
    }
    if (bookmark.archived_at_ms != null) {
      archived += 1;
      if (!opts.showArchived) continue;
    }
    if (isMergedReview(bookmark) && !opts.showMerged) {
      continue;
    }
    if (isNoDataReview(bookmark)) {
      noDataItems.push(bookmark);
      continue;
    }
    main.push(bookmark);
  }

  return {
    visible: main,
    noData: noDataItems,
    archivedCount: archived,
    mergedCount: merged,
  };
}

async function setArchived(bookmarkId: string, archived: boolean) {
  const path = archived ? "archive" : "unarchive";
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmarkId)}/${path}`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Failed to ${path} review`);
  }
}

export function ReviewsList({
  initialBookmarks,
}: {
  initialBookmarks: ReviewListItem[];
}) {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [showArchived, setShowArchived] = useState(false);
  const [showMerged, setShowMerged] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { visible, noData, archivedCount, mergedCount } = useMemo(
    () => partitionReviewsList(bookmarks, { showArchived, showMerged }),
    [bookmarks, showArchived, showMerged],
  );

  async function toggleArchive(bookmark: ReviewListItem) {
    const nextArchived = bookmark.archived_at_ms == null;
    setPendingId(bookmark.id);
    const previous = bookmarks;
    setBookmarks((current) =>
      current.map((item) =>
        item.id === bookmark.id
          ? {
              ...item,
              archived_at_ms: nextArchived ? Date.now() : null,
            }
          : item,
      ),
    );
    try {
      await setArchived(bookmark.id, nextArchived);
    } catch (error) {
      console.error(error);
      setBookmarks(previous);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => setShowMerged((value) => !value)}
          aria-pressed={showMerged}
          title={showMerged ? "Hide merged reviews" : "Show merged reviews"}
          className={`inline-flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium transition-colors ${
            showMerged
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {mergedCount > 0 ? `Merged (${mergedCount})` : "Merged"}
        </button>
        <button
          type="button"
          onClick={() => setShowArchived((value) => !value)}
          aria-pressed={showArchived}
          title={showArchived ? "Hide archived reviews" : "Show archived reviews"}
          className={`inline-flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium transition-colors ${
            showArchived
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {showArchived
            ? `Archived (${archivedCount})`
            : archivedCount > 0
              ? `Archived (${archivedCount})`
              : "Archived"}
        </button>
      </div>

          {visible.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-zinc-500 dark:text-zinc-500">
          {showArchived
            ? "No archived reviews."
            : noData.length > 0
              ? "No reviews with GX data yet."
              : showMerged
                ? "No reviews."
                : "No open reviews."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {visible.map((bookmark) => (
            <li key={bookmark.id} className="flex items-stretch gap-1">
              <Link
                href={`/reviews/${bookmark.id}`}
                className="flex min-w-0 flex-1 items-baseline justify-between gap-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium leading-5 text-zinc-950 dark:text-zinc-50">
                    {displayTitle(bookmark)}
                    {bookmark.archived_at_ms != null ? (
                      <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                        archived
                      </span>
                    ) : null}
                    {isMergedReview(bookmark) ? (
                      <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                        merged
                      </span>
                    ) : null}
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
              <button
                type="button"
                disabled={pendingId === bookmark.id}
                onClick={() => void toggleArchive(bookmark)}
                title={
                  bookmark.archived_at_ms != null
                    ? "Unarchive review"
                    : "Archive review"
                }
                className="inline-flex shrink-0 cursor-pointer items-center self-center px-2 py-2 text-zinc-500 transition-colors hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-500 dark:hover:text-zinc-50"
              >
                <Archive className="h-3.5 w-3.5" />
                <span className="sr-only">
                  {bookmark.archived_at_ms != null ? "Unarchive" : "Archive"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {noData.length > 0 ? (
        <details className="group border border-zinc-200 dark:border-zinc-800">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[12px] text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50 [&::-webkit-details-marker]:hidden">
            <span>
              Hid {noData.length} review{noData.length === 1 ? "" : "s"} without
              GX publish data
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {noData.map((bookmark) => (
              <li
                key={bookmark.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0 truncate text-[12px] text-zinc-600 dark:text-zinc-400">
                  {bookmark.repo_full_name} · {bookmark.branch_name}
                </span>
                {bookmark.github_pr_url ? (
                  <a
                    href={bookmark.github_pr_url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[12px] font-medium text-zinc-950 underline-offset-2 hover:underline dark:text-zinc-50"
                  >
                    {bookmark.github_pr_number
                      ? `PR #${bookmark.github_pr_number}`
                      : "GitHub PR"}
                  </a>
                ) : (
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    No PR link
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
