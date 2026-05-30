"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/button";
import {
  type BookmarkDetail,
  titleForBookmark,
} from "./use-pr-console-bookmarks";

function shouldUseLocalBookmarkApi(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function PrBookmarkTitleHeader({
  bookmark,
  onArchived,
}: {
  bookmark: BookmarkDetail | null;
  onArchived?: () => void | Promise<void>;
}) {
  const updateBookmarkTitle = useAction(api.gxBookmarkActions.updateBookmarkTitle);
  const closeBookmark = useAction(api.gxBookmarkActions.closeBookmark);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(
    bookmark ? titleForBookmark(bookmark) : "",
  );
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

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

  async function handleArchive() {
    if (!bookmark || bookmark.mergeStatus !== "open") return;
    setIsArchiving(true);
    setArchiveError(null);
    try {
      if (shouldUseLocalBookmarkApi()) {
        const response = await fetch(
          `/api/bookmarks/${encodeURIComponent(bookmark.id)}/close`,
          { method: "POST", credentials: "include" },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to archive bookmark.");
        }
      } else {
        await closeBookmark({ bookmarkId: bookmark.id });
      }
      await onArchived?.();
    } catch (error) {
      setArchiveError(
        error instanceof Error ? error.message : "Failed to archive bookmark.",
      );
    } finally {
      setIsArchiving(false);
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
            {isSavingTitle ? "Saving..." : "Save"}
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
          {bookmark?.mergeStatus === "open" ? (
            <>
              <Button variant="secondary" onClick={() => setIsEditingTitle(true)}>
                Edit title
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleArchive()}
                disabled={isArchiving}
              >
                {isArchiving ? "Archiving..." : "Archive"}
              </Button>
            </>
          ) : bookmark ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              {bookmark.mergeStatus}
            </span>
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
      {archiveError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{archiveError}</p>
      ) : null}
    </div>
  );
}
