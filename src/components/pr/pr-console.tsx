"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { PrChatPanel } from "./pr-chat-panel";
import { PrDebugTray } from "./pr-debug-tray";
import { PrMergeBar } from "./pr-merge-bar";
import { PrReviewWorkspaceProvider, usePrReviewWorkspace } from "./pr-review-workspace";
import { PrStackReview } from "./pr-stack-review";
import { extractStackChanges } from "@/lib/gx-stack";

type BookmarkListItem = {
  id: string;
  repoFullName: string;
  branchName: string;
  title?: string;
  revision: number;
  latestEventId: string;
  mergeStatus: "open" | "merged" | "closed";
  updatedAtMs: number;
};

type BookmarkDetail = BookmarkListItem & {
  payload?: unknown;
};

function CollapsedChatButton() {
  const { expandChat } = usePrReviewWorkspace();

  return (
    <button
      type="button"
      onClick={expandChat}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900/50 lg:h-[calc(100dvh-12rem)] lg:w-8 lg:flex-col lg:justify-start lg:gap-2 lg:py-3 lg:text-zinc-500 lg:hover:text-zinc-900 dark:lg:hover:text-zinc-50"
      aria-label="Show chat"
      title="Show chat"
    >
      <ChevronLeft className="size-4 shrink-0" />
      <span className="lg:text-[10px] lg:font-medium lg:uppercase lg:tracking-wide lg:[writing-mode:vertical-rl]">
        Chat
      </span>
    </button>
  );
}

function PrReviewWorkspaceContent({
  selectedDetail,
  stackBookmarks,
}: {
  selectedDetail: BookmarkDetail;
  stackBookmarks: Array<{ id: string; branchName: string; title?: string }>;
}) {
  const { chatCollapsed } = usePrReviewWorkspace();

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <PrMergeBar bookmark={selectedDetail} />
        <PrStackReview stackBookmarks={stackBookmarks} />
      </div>

      <div className="w-full shrink-0 lg:w-auto lg:sticky lg:top-6 lg:self-start">
        {chatCollapsed ? <CollapsedChatButton /> : <PrChatPanel />}
      </div>
    </>
  );
}

function titleForBookmark(bookmark: { title?: string; branchName: string }) {
  return bookmark.title?.trim() || bookmark.branchName;
}

function formatRelativeUpdated(timestampMs: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestampMs) / 1000));
  if (seconds < 60) return "Updated just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days}d ago`;
  return `Updated ${new Date(timestampMs).toLocaleDateString()}`;
}

function BookmarkTitleHeader({ bookmark }: { bookmark: BookmarkDetail | null }) {
  const updateBookmarkTitle = useMutation(api.gxPr.updateConsoleBookmarkTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(
    bookmark ? titleForBookmark(bookmark) : "",
  );
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  async function handleSaveTitle() {
    if (!bookmark) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("Title is required.");
      return;
    }
    setIsSavingTitle(true);
    setTitleError(null);
    try {
      await updateBookmarkTitle({
        bookmarkId: bookmark.id,
        title: trimmed,
      });
      setIsEditingTitle(false);
    } catch (error) {
      setTitleError(
        error instanceof Error ? error.message : "Failed to update bookmark title.",
      );
    } finally {
      setIsSavingTitle(false);
    }
  }

  return (
    <div className="space-y-1">
      {bookmark && isEditingTitle ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            className="w-full min-w-64 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xl font-semibold tracking-tight text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            maxLength={280}
            aria-label="Bookmark title"
          />
          <Button onClick={() => void handleSaveTitle()} disabled={isSavingTitle}>
            {isSavingTitle ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setIsEditingTitle(false);
              setTitleDraft(bookmark ? titleForBookmark(bookmark) : "");
              setTitleError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {bookmark ? titleForBookmark(bookmark) : "Bookmarks"}
          </h1>
          {bookmark ? (
            <Button variant="secondary" onClick={() => setIsEditingTitle(true)}>
              Edit title
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Bookmarks from <code className="text-xs">gx pr</code>. Select one to
        preview trees, diffs, and merge status.
      </p>
      {titleError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{titleError}</p>
      ) : null}
    </div>
  );
}

export function PrConsole() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const authReady =
    !sessionPending &&
    !convexAuthLoading &&
    Boolean(session?.user) &&
    isAuthenticated;

  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("bookmark"),
  );
  const [trayOpen, setTrayOpen] = useState(false);
  const [showMerged, setShowMerged] = useState(false);
  const [groupByRepo, setGroupByRepo] = useState(false);
  const [bookmarksCollapsed, setBookmarksCollapsed] = useState(true);

  const bookmarks = useQuery(
    api.gxPr.listConsoleBookmarks,
    authReady ? { mergeStatus: showMerged ? undefined : "open" } : "skip",
  ) as BookmarkListItem[] | undefined;

  const urlBookmarkId = searchParams.get("bookmark");
  const selectedIdInList =
    selectedId && bookmarks?.some((item) => item.id === selectedId)
      ? selectedId
      : null;
  const effectiveSelectedId =
    urlBookmarkId ?? selectedIdInList ?? bookmarks?.[0]?.id ?? null;

  const selectedDetail = useQuery(
    api.gxPr.getConsoleBookmarkDetail,
    authReady && effectiveSelectedId
      ? { bookmarkId: effectiveSelectedId, includePayload: true }
      : "skip",
  ) as BookmarkDetail | null | undefined;

  const selected = useMemo(() => {
    if (!bookmarks?.length) return null;
    const id = effectiveSelectedId;
    if (!id) return bookmarks[0];
    return bookmarks.find((bookmark) => bookmark.id === id) ?? null;
  }, [bookmarks, effectiveSelectedId]);

  function setBookmarkQueryParam(bookmarkId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (bookmarkId) {
      params.set("bookmark", bookmarkId);
    } else {
      params.delete("bookmark");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function handleSelectBookmark(bookmarkId: string) {
    setSelectedId(bookmarkId);
    setBookmarkQueryParam(bookmarkId);
  }

  const stackBookmarks = useMemo(() => {
    if (!selectedDetail?.payload || !bookmarks?.length) {
      return bookmarks?.map((bookmark) => ({
        id: bookmark.id,
        branchName: bookmark.branchName,
        title: bookmark.title,
      })) ?? [];
    }

    const stackBranches = new Set(
      extractStackChanges(selectedDetail.payload).map((change) => change.branchName),
    );

    return bookmarks
      .filter((bookmark) => stackBranches.has(bookmark.branchName))
      .map((bookmark) => ({
        id: bookmark.id,
        branchName: bookmark.branchName,
        title: bookmark.title,
      }));
  }, [bookmarks, selectedDetail]);

  const groupedBookmarks = useMemo(() => {
    const grouped = new Map<string, BookmarkListItem[]>();
    for (const bookmark of bookmarks ?? []) {
      const list = grouped.get(bookmark.repoFullName);
      if (list) {
        list.push(bookmark);
      } else {
        grouped.set(bookmark.repoFullName, [bookmark]);
      }
    }
    return grouped;
  }, [bookmarks]);

  const listLoading = authReady && bookmarks === undefined;
  const detailLoading =
    authReady && Boolean(effectiveSelectedId) && selectedDetail === undefined;

  if (!authReady || listLoading) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  const detailError =
    effectiveSelectedId && selectedDetail === null ? "Bookmark not found." : null;

  return (
    <div className="flex min-h-0 w-full max-w-[96rem] flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <BookmarkTitleHeader
          key={
            selectedDetail
              ? `${selectedDetail.id}:${titleForBookmark(selectedDetail)}`
              : "empty"
          }
          bookmark={selectedDetail ?? null}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant={showMerged ? "primary" : "secondary"} onClick={() => setShowMerged((current) => !current)}>
            {showMerged ? "Showing merged" : "Merged"}
          </Button>
          <Button
            variant={groupByRepo ? "primary" : "secondary"}
            onClick={() => setGroupByRepo((current) => !current)}
          >
            Group by repo
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTrayOpen(true)}
            disabled={!selectedDetail}
          >
            Raw data tray
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start">
        {bookmarksCollapsed ? (
          <button
            type="button"
            onClick={() => setBookmarksCollapsed(false)}
            className="hidden shrink-0 items-center justify-center self-stretch rounded-md border border-zinc-200 px-1.5 text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-50 lg:flex"
            aria-label="Show bookmarks"
            title="Show bookmarks"
          >
            <ChevronRight className="size-4" />
          </button>
        ) : null}
        <aside
          className={`flex w-full shrink-0 flex-col gap-2 lg:w-72 ${bookmarksCollapsed ? "lg:hidden" : ""}`}
        >
          <div className="hidden items-center justify-between gap-2 px-1 lg:flex">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Bookmarks
            </p>
            <button
              type="button"
              onClick={() => setBookmarksCollapsed(true)}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              aria-label="Hide bookmarks"
              title="Hide bookmarks"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
          {!bookmarks?.length ? (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              No bookmarks yet.
            </div>
          ) : groupByRepo ? (
            <ul className="flex flex-col gap-3 overflow-auto">
              {Array.from(groupedBookmarks.entries()).map(([repoFullName, repoBookmarks]) => (
                <li key={repoFullName} className="space-y-1">
                  <p className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {repoFullName}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {repoBookmarks.map((bookmark) => {
                      const active = selected?.id === bookmark.id;
                      return (
                        <li key={bookmark.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectBookmark(bookmark.id)}
                            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              active
                                ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                            }`}
                          >
                            <div className="font-medium text-zinc-900 dark:text-zinc-50">
                              {titleForBookmark(bookmark)}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-zinc-500">
                              {bookmark.repoFullName}
                            </div>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              {formatRelativeUpdated(bookmark.updatedAtMs)}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-1 overflow-auto">
              {bookmarks.map((bookmark) => {
                const active = selected?.id === bookmark.id;
                return (
                  <li key={bookmark.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectBookmark(bookmark.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                      }`}
                    >
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">
                        {titleForBookmark(bookmark)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-zinc-500">
                        {bookmark.repoFullName}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {formatRelativeUpdated(bookmark.updatedAtMs)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {detailLoading ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              Loading bookmark detail…
            </div>
          </div>
        ) : detailError ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-1 items-center justify-center rounded-lg border border-red-300 p-8 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
              {detailError}
            </div>
          </div>
        ) : selectedDetail ? (
          <PrReviewWorkspaceProvider
            key={selectedDetail.id}
            bookmark={selectedDetail}
          >
            <PrReviewWorkspaceContent
              selectedDetail={selectedDetail}
              stackBookmarks={stackBookmarks}
            />
          </PrReviewWorkspaceProvider>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              Select a bookmark to preview
            </div>
          </div>
        )}
      </div>

      <PrDebugTray
        open={trayOpen}
        onOpenChange={setTrayOpen}
        data={selectedDetail?.payload ?? selectedDetail ?? null}
      />
    </div>
  );
}
