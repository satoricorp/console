"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { resolveReviewPayload, isReviewablePayload } from "@/lib/bookmark-review";
import { extractStackChanges } from "@/lib/gx-stack";

export type BookmarkListItem = {
  id: string;
  repoFullName: string;
  branchName: string;
  title?: string;
  revision: number;
  latestEventId: string;
  mergeStatus: "open" | "merged" | "closed";
  updatedAtMs: number;
};

export type BookmarkDetail = BookmarkListItem & {
  payload?: unknown;
  payloadSourceBookmarkId?: string | null;
  initialJjChangeId?: string | null;
};

type PayloadState = {
  bookmarkId: string | null;
  payload?: unknown;
  payloadSourceBookmarkId?: string | null;
  initialJjChangeId?: string | null;
  ready: boolean;
  error: string | null;
};

export function titleForBookmark(bookmark: { title?: string; branchName: string }) {
  return bookmark.title?.trim() || bookmark.branchName;
}

function shouldUseLocalBookmarkApi(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function fetchBookmarkList(
  mergeStatus: "open" | "merged" | "closed" | undefined,
): Promise<BookmarkListItem[]> {
  if (shouldUseLocalBookmarkApi()) {
    const params = new URLSearchParams();
    if (mergeStatus) {
      params.set("merge_status", mergeStatus);
    }
    const response = await fetch(`/api/bookmarks?${params.toString()}`, {
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to load bookmarks.");
    }
    const rows = (await response.json()) as Array<{
      id: string;
      repoFullName: string;
      branchName: string;
      title?: string | null;
      revision: number;
      latestEventId: string;
      mergeStatus: "open" | "merged" | "closed";
      updatedAtMs: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      repoFullName: row.repoFullName,
      branchName: row.branchName,
      title: row.title ?? undefined,
      revision: row.revision,
      latestEventId: row.latestEventId,
      mergeStatus: row.mergeStatus,
      updatedAtMs: row.updatedAtMs,
    }));
  }

  throw new Error("Remote bookmark list requires Convex action path.");
}

function loadBookmarkPayloadLocally(bookmarkId: string): Promise<unknown | undefined> {
  return fetch(`/api/bookmarks/${encodeURIComponent(bookmarkId)}?include_payload=1`, {
    credentials: "include",
  }).then(async (response) => {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to load bookmark payload.");
    }
    const detail = (await response.json()) as BookmarkDetail;
    return detail.payload;
  });
}

export function formatRelativeUpdated(timestampMs: number): string {
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

export function usePrConsoleBookmarks({
  authReady,
  showMerged,
}: {
  authReady: boolean;
  showMerged: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const listMyBookmarks = useAction(api.gxBookmarkActions.listMyBookmarks);
  const getBookmarkDetail = useAction(api.gxBookmarkActions.getBookmarkDetail);

  const [bookmarks, setBookmarks] = useState<BookmarkListItem[] | undefined>(undefined);
  const [listError, setListError] = useState<string | null>(null);

  const loadBookmarks = useCallback(async () => {
    const mergeStatus = showMerged ? undefined : ("open" as const);
    if (shouldUseLocalBookmarkApi()) {
      return fetchBookmarkList(mergeStatus);
    }
    const rows = await listMyBookmarks({ mergeStatus });
    return rows.map((row) => ({
      id: row.id,
      repoFullName: row.repoFullName,
      branchName: row.branchName,
      title: row.title,
      revision: row.revision,
      latestEventId: row.latestEventId,
      mergeStatus: row.mergeStatus,
      updatedAtMs: row.updatedAtMs,
    }));
  }, [listMyBookmarks, showMerged]);

  useEffect(() => {
    if (!authReady) {
      setBookmarks(undefined);
      setListError(null);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await loadBookmarks();
        if (!cancelled) {
          setBookmarks(next);
          setListError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setBookmarks([]);
          setListError(
            error instanceof Error ? error.message : "Failed to load bookmarks.",
          );
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authReady, loadBookmarks]);

  const urlBookmarkId = searchParams.get("bookmark");
  const selectedId =
    (urlBookmarkId && bookmarks?.some((item) => item.id === urlBookmarkId)
      ? urlBookmarkId
      : bookmarks?.[0]?.id) ?? null;

  const selectedMeta = useMemo(() => {
    if (!selectedId || !bookmarks) {
      return undefined;
    }
    return bookmarks.find((bookmark) => bookmark.id === selectedId) ?? null;
  }, [bookmarks, selectedId]);

  const [payloadState, setPayloadState] = useState<PayloadState>({
    bookmarkId: null,
    ready: false,
    error: null,
  });

  useEffect(() => {
    if (!authReady || !selectedId) {
      setPayloadState({ bookmarkId: null, ready: false, error: null });
      return;
    }
    if (selectedMeta === undefined || !bookmarks?.length) {
      return;
    }
    if (selectedMeta === null) {
      setPayloadState({
        bookmarkId: selectedId,
        ready: true,
        error: "Bookmark not found.",
      });
      return;
    }

    let cancelled = false;
    setPayloadState({ bookmarkId: selectedId, ready: false, error: null });

    const loadPayloadForId = (bookmarkId: string) =>
      shouldUseLocalBookmarkApi()
        ? loadBookmarkPayloadLocally(bookmarkId)
        : getBookmarkDetail({ bookmarkId, includePayload: true }).then((detail) => {
            if (!detail) {
              throw new Error("Bookmark not found.");
            }
            return detail.payload;
          });

    void resolveReviewPayload({
      bookmark: selectedMeta,
      bookmarks,
      loadPayload: loadPayloadForId,
    })
      .then((resolved) => {
        if (cancelled) return;
        setPayloadState({
          bookmarkId: selectedId,
          payload: resolved.payload,
          payloadSourceBookmarkId: resolved.sourceBookmarkId,
          initialJjChangeId: resolved.initialJjChangeId,
          ready: true,
          error:
            resolved.payload && isReviewablePayload(resolved.payload, selectedMeta.repoFullName)
              ? null
              : "This bookmark has no gx pr change data. Re-run gx pr on the branch, or open the latest stack bookmark for this repo.",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPayloadState({
          bookmarkId: selectedId,
          ready: true,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load bookmark payload.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, bookmarks, selectedId, selectedMeta, getBookmarkDetail]);

  useEffect(() => {
    if (
      !payloadState.ready ||
      !payloadState.initialJjChangeId ||
      !payloadState.payloadSourceBookmarkId ||
      !selectedId ||
      payloadState.bookmarkId !== selectedId
    ) {
      return;
    }

    const currentChange = searchParams.get("change");
    if (currentChange === payloadState.initialJjChangeId) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("bookmark", selectedId);
    params.set("change", payloadState.initialJjChangeId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [
    pathname,
    payloadState.bookmarkId,
    payloadState.initialJjChangeId,
    payloadState.payloadSourceBookmarkId,
    payloadState.ready,
    router,
    searchParams,
    selectedId,
  ]);

  const selectedDetail = useMemo((): BookmarkDetail | null | undefined => {
    if (!selectedId) return undefined;
    if (
      selectedMeta === undefined ||
      payloadState.bookmarkId !== selectedId ||
      !payloadState.ready
    ) {
      return undefined;
    }
    if (selectedMeta === null) return null;
    return {
      ...selectedMeta,
      payload: payloadState.payload,
      payloadSourceBookmarkId: payloadState.payloadSourceBookmarkId ?? null,
      initialJjChangeId: payloadState.initialJjChangeId ?? null,
    };
  }, [selectedId, selectedMeta, payloadState]);

  const selected = useMemo(() => {
    if (!bookmarks?.length) return null;
    if (!selectedId) return bookmarks[0];
    return bookmarks.find((bookmark) => bookmark.id === selectedId) ?? bookmarks[0];
  }, [bookmarks, selectedId]);

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
      .filter(
        (bookmark) =>
          stackBranches.has(bookmark.branchName) ||
          bookmark.id === selectedDetail.id ||
          bookmark.id === selectedDetail.payloadSourceBookmarkId,
      )
      .map((bookmark) => ({
        id: bookmark.id,
        branchName: bookmark.branchName,
        title: bookmark.title,
      }));
  }, [bookmarks, selectedDetail]);

  function selectBookmark(bookmarkId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("bookmark", bookmarkId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return {
    bookmarks,
    selected,
    selectedId,
    selectedDetail,
    groupedBookmarks,
    stackBookmarks,
    listLoading: authReady && bookmarks === undefined,
    detailLoading: authReady && Boolean(selectedId) && selectedDetail === undefined,
    detailError:
      listError ??
      payloadState.error ??
      (selectedId && selectedDetail === null ? "Bookmark not found." : null),
    selectBookmark,
  };
}
