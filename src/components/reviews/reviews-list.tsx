"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, Filter, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export type ReviewsListFilter = "open" | "merged" | "closed" | "archived";

const FILTER_OPTIONS: { value: ReviewsListFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];

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

/** Partition a status-filtered bookmark page into main list vs no-data. */
export function partitionReviewsList(
  bookmarks: ReviewListItem[],
  _opts?: { showArchived?: boolean; showMerged?: boolean },
) {
  const noDataItems: ReviewListItem[] = [];
  const main: ReviewListItem[] = [];

  for (const bookmark of bookmarks) {
    if (isNoDataReview(bookmark)) {
      noDataItems.push(bookmark);
      continue;
    }
    main.push(bookmark);
  }

  return {
    visible: main,
    noData: noDataItems,
  };
}

export type ReviewRepoGroup = {
  repoFullName: string;
  bookmarks: ReviewListItem[];
};

/**
 * Group reviews by repo for the list UI. Repo order follows the most recent
 * bookmark in each group (input is already updated_at DESC from the API).
 */
export function groupReviewsByRepo(
  bookmarks: ReviewListItem[],
): ReviewRepoGroup[] {
  const groups: ReviewRepoGroup[] = [];
  const indexByRepo = new Map<string, number>();

  for (const bookmark of bookmarks) {
    const existing = indexByRepo.get(bookmark.repo_full_name);
    if (existing === undefined) {
      indexByRepo.set(bookmark.repo_full_name, groups.length);
      groups.push({
        repoFullName: bookmark.repo_full_name,
        bookmarks: [bookmark],
      });
    } else {
      groups[existing]!.bookmarks.push(bookmark);
    }
  }

  return groups;
}

async function fetchBookmarks(filter: ReviewsListFilter): Promise<ReviewListItem[]> {
  const response = await fetch(
    `/api/bookmarks?merge_status=${encodeURIComponent(filter)}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to load reviews");
  }
  return (await response.json()) as ReviewListItem[];
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
  initialFilter = "open",
}: {
  initialBookmarks: ReviewListItem[];
  initialFilter?: ReviewsListFilter;
}) {
  const [filter, setFilter] = useState<ReviewsListFilter>(initialFilter);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [listLoading, setListLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (filter === initialFilter) {
      setBookmarks(initialBookmarks);
      return;
    }

    let cancelled = false;
    setListLoading(true);
    void fetchBookmarks(filter)
      .then((rows) => {
        if (!cancelled) setBookmarks(rows);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter, initialBookmarks, initialFilter]);

  const { visible, noData } = useMemo(
    () => partitionReviewsList(bookmarks),
    [bookmarks],
  );
  const repoGroups = useMemo(() => groupReviewsByRepo(visible), [visible]);

  const filterLabel =
    FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? "Open";

  async function toggleArchive(bookmark: ReviewListItem) {
    const nextArchived = bookmark.archived_at_ms == null;
    setPendingId(bookmark.id);
    const previous = bookmarks;
    // Optimistically drop from the current exclusive filter view.
    setBookmarks((current) =>
      current.filter((item) => item.id !== bookmark.id),
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

  const emptyMessage =
    filter === "archived"
      ? "No archived reviews."
      : noData.length > 0
        ? "No reviews with GX data yet."
        : filter === "open"
          ? "No open reviews."
          : `No ${filter} reviews.`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={`Filter: ${filterLabel}`}
              aria-label={`Filter reviews by status, currently ${filterLabel}`}
              className="inline-flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:text-zinc-950 data-[state=open]:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50 dark:data-[state=open]:text-zinc-50"
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="sr-only">{filterLabel}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[8.5rem]">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => setFilter(value as ReviewsListFilter)}
            >
              {FILTER_OPTIONS.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="text-[12px]"
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {listLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-zinc-500 dark:text-zinc-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-5">
          {repoGroups.map((group) => (
            <section key={group.repoFullName}>
              <h2 className="mb-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-500">
                {group.repoFullName}
              </h2>
              <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {group.bookmarks.map((bookmark) => (
                  <li key={bookmark.id} className="flex items-stretch gap-1">
                    <Link
                      href={`/reviews/${bookmark.id}`}
                      onClick={() => setLoadingId(bookmark.id)}
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
                          {bookmark.merge_status === "merged" &&
                          bookmark.archived_at_ms == null ? (
                            <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                              merged
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
                          {bookmark.branch_name}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-right text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
                        {loadingId === bookmark.id ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-label="Loading review"
                          />
                        ) : null}
                        <span>
                          {bookmark.merge_status}
                          <span className="block">
                            {formatDate(bookmark.updated_at_ms)}
                          </span>
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
                        {bookmark.archived_at_ms != null
                          ? "Unarchive"
                          : "Archive"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {noData.length > 0 && !listLoading ? (
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
