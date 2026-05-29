"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { PrChatPanel } from "./pr-chat-panel";
import { PrDebugTray } from "./pr-debug-tray";
import { PrMergeBar } from "./pr-merge-bar";
import { PrStackReview } from "./pr-stack-review";
import { extractStackChanges } from "@/lib/gx-stack";
import type { ChatPin } from "@/lib/chat-pin";

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
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [chatPins, setChatPins] = useState<ChatPin[]>([]);

  const bookmarks = useQuery(
    api.gxPr.listConsoleBookmarks,
    authReady ? { mergeStatus: showMerged ? undefined : "open" } : "skip",
  ) as BookmarkListItem[] | undefined;

  const selectedDetail = useQuery(
    api.gxPr.getConsoleBookmarkDetail,
    authReady && selectedId
      ? { bookmarkId: selectedId, includePayload: true }
      : "skip",
  ) as BookmarkDetail | null | undefined;

  const updateBookmarkTitle = useMutation(api.gxPr.updateConsoleBookmarkTitle);

  useEffect(() => {
    const fromUrl = searchParams.get("bookmark");
    if (fromUrl) {
      setSelectedId(fromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    if (bookmarks === undefined) {
      return;
    }
    const fromUrl = searchParams.get("bookmark");
    const candidateId = selectedId ?? fromUrl;
    const resolvedId =
      (candidateId && bookmarks.some((item) => item.id === candidateId)
        ? candidateId
        : bookmarks[0]?.id) ?? null;
    if (resolvedId !== selectedId) {
      setSelectedId(resolvedId);
    }
  }, [bookmarks, searchParams, selectedId]);

  const selected = useMemo(() => {
    if (!bookmarks?.length) return null;
    if (!selectedId) return bookmarks[0];
    return bookmarks.find((bookmark) => bookmark.id === selectedId) ?? bookmarks[0];
  }, [bookmarks, selectedId]);

  useEffect(() => {
    setIsEditingTitle(false);
    setTitleDraft(selectedDetail ? titleForBookmark(selectedDetail) : "");
    setTitleError(null);
  }, [selectedDetail]);

  useEffect(() => {
    setChatPins([]);
  }, [selectedId]);

  function handleAddChatPin(pin: ChatPin) {
    setChatPins((current) => {
      const existing = current.find((entry) => entry.id === pin.id);
      if (existing) return current;
      return [...current, pin];
    });
  }

  function handleRemoveChatPin(pinId: string) {
    setChatPins((current) => current.filter((pin) => pin.id !== pinId));
  }

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

  async function handleSaveTitle() {
    if (!selectedDetail) return;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleError("Title is required.");
      return;
    }
    setIsSavingTitle(true);
    setTitleError(null);
    try {
      await updateBookmarkTitle({
        bookmarkId: selectedDetail.id,
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
  }, [bookmarks, selectedDetail?.payload]);

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
  const detailLoading = authReady && Boolean(selectedId) && selectedDetail === undefined;

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
    selectedId && selectedDetail === null ? "Bookmark not found." : null;

  return (
    <div className="flex min-h-0 w-full max-w-[96rem] flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          {selectedDetail && isEditingTitle ? (
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
                  setTitleDraft(selectedDetail ? titleForBookmark(selectedDetail) : "");
                  setTitleError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {selectedDetail ? titleForBookmark(selectedDetail) : "Bookmarks"}
              </h1>
              {selectedDetail ? (
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
        <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {detailLoading ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              Loading bookmark detail…
            </div>
          ) : detailError ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-red-300 p-8 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
              {detailError}
            </div>
          ) : selectedDetail ? (
            <>
              <PrMergeBar bookmark={selectedDetail} />
              <PrStackReview
                bookmarkId={selectedDetail.id}
                repoFullName={selectedDetail.repoFullName}
                payload={selectedDetail.payload}
                stackBookmarks={stackBookmarks}
                onAddChatPin={handleAddChatPin}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
              Select a bookmark to preview
            </div>
          )}
        </div>

        {selectedDetail ? (
          <PrChatPanel
            bookmark={selectedDetail}
            pins={chatPins}
            onRemovePin={handleRemoveChatPin}
          />
        ) : null}
      </div>

      <PrDebugTray
        open={trayOpen}
        onOpenChange={setTrayOpen}
        data={selectedDetail?.payload ?? selectedDetail ?? null}
      />
    </div>
  );
}
