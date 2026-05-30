import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import type { ChatPin } from "@/lib/chat-pin";

export type DiffComment = {
  id: string;
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  body: string;
  createdAtMs: number;
};

export type PendingDiffComment = {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  excerpt: string;
};

export type DiffCommentAnnotationMeta =
  | { kind: "saved"; comment: DiffComment }
  | { kind: "draft" };

export function pendingFromChatPin(pin: ChatPin): PendingDiffComment {
  return {
    filePath: pin.filePath,
    side: pin.side,
    startLine: pin.startLine,
    endLine: pin.endLine,
    excerpt: pin.text,
  };
}

export function pendingSelectionRange(
  pending: PendingDiffComment,
): SelectedLineRange {
  return {
    side: pending.side,
    start: pending.startLine,
    end: pending.endLine,
  };
}

export function commentToAnnotation(
  comment: DiffComment,
): DiffLineAnnotation<DiffCommentAnnotationMeta> {
  return {
    side: comment.side,
    lineNumber: comment.startLine,
    metadata: { kind: "saved", comment },
  };
}

export function draftToAnnotation(
  pending: PendingDiffComment,
): DiffLineAnnotation<DiffCommentAnnotationMeta> {
  return {
    side: pending.side,
    lineNumber: pending.startLine,
    metadata: { kind: "draft" },
  };
}

export function annotationsForFile(
  filePath: string,
  comments: DiffComment[],
  pending: PendingDiffComment | null,
): DiffLineAnnotation<DiffCommentAnnotationMeta>[] {
  const annotations = comments
    .filter((comment) => comment.filePath === filePath)
    .map(commentToAnnotation);

  if (pending != null && pending.filePath === filePath) {
    annotations.push(draftToAnnotation(pending));
  }

  return annotations;
}

export function createDiffComment(
  pending: PendingDiffComment,
  body: string,
): DiffComment {
  const trimmed = body.trim();
  return {
    id: `${pending.filePath}:${pending.side}:${pending.startLine}-${pending.endLine}:${Date.now()}`,
    filePath: pending.filePath,
    side: pending.side,
    startLine: pending.startLine,
    endLine: pending.endLine,
    body: trimmed,
    createdAtMs: Date.now(),
  };
}

export function formatCommentLineLabel(
  startLine: number,
  endLine: number,
): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}
