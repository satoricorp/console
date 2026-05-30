import {
  extractStackChanges,
  type StackChangeItem,
} from "@/lib/gx-stack";
import { extractMergeTarget } from "@/lib/gx-pr-payload";

export function isReviewablePayload(
  payload: unknown,
  repoFullName?: string,
): boolean {
  if (extractStackChanges(payload).length > 0) {
    return true;
  }
  return extractMergeTarget(payload, repoFullName) !== null;
}

export function findMatchingStackChange(
  payload: unknown,
  bookmark: { branchName: string; title?: string },
): StackChangeItem | null {
  const changes = extractStackChanges(payload);
  if (changes.length === 0) {
    return null;
  }

  const byBranch = changes.find(
    (change) => change.branchName === bookmark.branchName,
  );
  if (byBranch) {
    return byBranch;
  }

  const titleKey = bookmark.title?.trim();
  if (titleKey) {
    const byTitle = changes.find((change) => {
      const firstLine = change.description.split("\n")[0]?.trim();
      return firstLine === titleKey || change.description.includes(titleKey);
    });
    if (byTitle) {
      return byTitle;
    }
  }

  return null;
}

export async function resolveReviewPayload({
  bookmark,
  bookmarks,
  loadPayload,
}: {
  bookmark: { id: string; repoFullName: string; branchName: string; title?: string };
  bookmarks: Array<{ id: string; repoFullName: string; branchName: string; title?: string; updatedAtMs: number }>;
  loadPayload: (bookmarkId: string) => Promise<unknown | undefined>;
}): Promise<{
  payload: unknown | undefined;
  initialJjChangeId: string | null;
  sourceBookmarkId: string | null;
}> {
  const primary = await loadPayload(bookmark.id);
  if (primary && isReviewablePayload(primary, bookmark.repoFullName)) {
    return {
      payload: primary,
      initialJjChangeId: null,
      sourceBookmarkId: null,
    };
  }

  const siblings = bookmarks
    .filter(
      (candidate) =>
        candidate.repoFullName === bookmark.repoFullName &&
        candidate.id !== bookmark.id,
    )
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);

  for (const sibling of siblings) {
    const payload = await loadPayload(sibling.id);
    if (!payload || extractStackChanges(payload).length === 0) {
      continue;
    }

    const match = findMatchingStackChange(payload, bookmark);
    return {
      payload,
      initialJjChangeId:
        match?.jjChangeId ?? extractStackChanges(payload)[0]?.jjChangeId ?? null,
      sourceBookmarkId: sibling.id,
    };
  }

  return {
    payload: primary,
    initialJjChangeId: null,
    sourceBookmarkId: null,
  };
}
