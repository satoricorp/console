import type { PushBundle } from "./types";

export const PLACEHOLDER_DESCRIPTION = "(no description set)";

export function isPlaceholderDescription(
  description: string | null | undefined,
): boolean {
  if (typeof description !== "string") {
    return true;
  }
  const trimmed = description.trim();
  return trimmed === "" || trimmed === PLACEHOLDER_DESCRIPTION;
}

function stackDescriptions(payload: PushBundle): string[] {
  if (Array.isArray(payload.stack) && payload.stack.length > 0) {
    return payload.stack
      .map((item) => item.change?.description)
      .filter((description): description is string => typeof description === "string");
  }

  const changeDescription = payload.change?.description;
  return typeof changeDescription === "string" ? [changeDescription] : [];
}

function isFakeHeadCommitId(headCommitId: string | null | undefined): boolean {
  if (!headCommitId) {
    return true;
  }
  const trimmed = headCommitId.trim();
  if (trimmed === "abc" || trimmed === "abc123") {
    return true;
  }
  return trimmed.length < 20;
}

export type BookmarkEmptyMeta = {
  headCommitId?: string | null;
  updatedAtMs?: number;
  branchName?: string;
};

export function isEffectivelyEmptyBookmark(
  payload: PushBundle,
  meta: BookmarkEmptyMeta = {},
): boolean {
  if (meta.branchName === "unknown") {
    return true;
  }

  if (
    meta.updatedAtMs !== undefined &&
    meta.updatedAtMs <= 1 &&
    isFakeHeadCommitId(meta.headCommitId)
  ) {
    return true;
  }

  const hasStack = Array.isArray(payload.stack) && payload.stack.length > 0;
  const hasChange = payload.change != null;
  if (!hasStack && !hasChange) {
    return true;
  }

  const descriptions = stackDescriptions(payload);
  if (descriptions.length === 0) {
    return true;
  }

  return descriptions.every(isPlaceholderDescription);
}
