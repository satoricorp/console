export type ConsoleBookmark = {
  id: string;
  repoFullName: string;
  branchName: string;
  title: string | null;
  revision: number;
  latestEventId: string;
  headCommitId: string | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  remoteHeadSha: string | null;
  mergeStatus: "open" | "merged" | "closed";
  mergedAtMs?: number;
  publishedAtMs: number;
  updatedAtMs: number;
  storageBackend: string;
  payload?: unknown;
};

export type ChangeReviewRecord = {
  jjChangeId: string;
  stackIndex: number;
  approvalPercent: number;
  notes?: string;
  updatedAtMs: number;
};

async function parseError(response: Response, fallback: string): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? fallback);
}

export async function fetchBookmarkList(
  mergeStatus?: "open" | "merged" | "closed",
): Promise<ConsoleBookmark[]> {
  const params = new URLSearchParams();
  if (mergeStatus) {
    params.set("merge_status", mergeStatus);
  }
  const response = await fetch(`/api/bookmarks?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    return parseError(response, "Failed to load bookmarks.");
  }
  return (await response.json()) as ConsoleBookmark[];
}

export async function fetchBookmarkDetail(
  bookmarkId: string,
  includePayload = false,
): Promise<ConsoleBookmark | null> {
  const params = includePayload ? "?include_payload=1" : "";
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmarkId)}${params}`,
    { credentials: "include" },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    return parseError(response, "Failed to load bookmark.");
  }
  return (await response.json()) as ConsoleBookmark;
}

export async function fetchBookmarkIdByEvent(eventId: string): Promise<string | null> {
  const response = await fetch(
    `/api/bookmarks/by-event/${encodeURIComponent(eventId)}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    return parseError(response, "Failed to resolve bookmark.");
  }
  const body = (await response.json()) as { bookmarkId: string | null };
  return body.bookmarkId;
}

export async function closeBookmarkRequest(bookmarkId: string): Promise<void> {
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmarkId)}/close`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    return parseError(response, "Failed to archive bookmark.");
  }
}

export async function updateBookmarkTitleRequest(
  bookmarkId: string,
  title: string,
): Promise<void> {
  const response = await fetch(`/api/bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    return parseError(response, "Failed to update bookmark title.");
  }
}

export async function fetchChangeReviews(
  bookmarkId: string,
): Promise<ChangeReviewRecord[]> {
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmarkId)}/change-reviews`,
    { credentials: "include" },
  );
  if (!response.ok) {
    return parseError(response, "Failed to load change reviews.");
  }
  return (await response.json()) as ChangeReviewRecord[];
}

export async function upsertChangeReviewRequest(
  bookmarkId: string,
  review: {
    jjChangeId: string;
    stackIndex: number;
    approvalPercent: number;
    notes?: string;
  },
): Promise<ChangeReviewRecord> {
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmarkId)}/change-reviews`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(review),
    },
  );
  if (!response.ok) {
    return parseError(response, "Failed to save change review.");
  }
  return (await response.json()) as ChangeReviewRecord;
}
