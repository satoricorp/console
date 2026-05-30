"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useConvexAuth } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { PrBookmarkTitleHeader } from "./pr-bookmark-title-header";
import { PrChatPanel } from "./pr-chat-panel";
import { PrDebugTray } from "./pr-debug-tray";
import { PrMergeBar } from "./pr-merge-bar";
import { PrReviewWorkspaceProvider, usePrReviewWorkspace } from "./pr-review-workspace";
import { PrStackReview } from "./pr-stack-review";
import {
  type BookmarkDetail,
  formatRelativeUpdated,
  titleForBookmark,
  usePrConsoleBookmarks,
} from "./use-pr-console-bookmarks";

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
  detailError,
}: {
  selectedDetail: BookmarkDetail;
  stackBookmarks: Array<{ id: string; branchName: string; title?: string }>;
  detailError: string | null;
}) {
  const { chatCollapsed } = usePrReviewWorkspace();

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {detailError ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {detailError}
          </div>
        ) : null}
        {selectedDetail.payloadSourceBookmarkId ? (
          <div className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            Showing stack review data from the latest bookmark in this repo.
          </div>
        ) : null}
        <PrMergeBar bookmark={selectedDetail} />
        <PrStackReview stackBookmarks={stackBookmarks} />
      </div>

      <div className="w-full shrink-0 lg:sticky lg:top-6 lg:w-auto lg:self-start">
        {chatCollapsed ? <CollapsedChatButton /> : <PrChatPanel />}
      </div>
    </>
  );
}

export function PrConsole() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const authReady =
    !sessionPending &&
    !convexAuthLoading &&
    Boolean(session?.user) &&
    isAuthenticated;

  const [trayOpen, setTrayOpen] = useState(false);
  const [showMerged, setShowMerged] = useState(false);
  const [groupByRepo, setGroupByRepo] = useState(false);
  const [bookmarksCollapsed, setBookmarksCollapsed] = useState(true);
  const {
    bookmarks,
    selected,
    selectedDetail,
    groupedBookmarks,
    stackBookmarks,
    listLoading,
    detailLoading,
    detailError,
    selectBookmark,
  } = usePrConsoleBookmarks({ authReady, showMerged });

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

  return (
    <div className="flex min-h-0 w-full max-w-[96rem] flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <PrBookmarkTitleHeader
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
                            onClick={() => selectBookmark(bookmark.id)}
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
                      onClick={() => selectBookmark(bookmark.id)}
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
              detailError={detailError}
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
