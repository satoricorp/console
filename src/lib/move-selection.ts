import type { ChatPin } from "@/lib/chat-pin";
import { formatChatPinLabel } from "@/lib/chat-pin";

export function pathsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

export type LineRangeSelection = {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  excerpt: string;
};

export type MoveSelection = {
  jjChangeId: string;
  filePaths: string[];
  lineRanges: LineRangeSelection[];
};

export function lineRangeFromChatPin(pin: ChatPin): LineRangeSelection {
  return {
    filePath: pin.filePath,
    side: pin.side,
    startLine: pin.startLine,
    endLine: pin.endLine,
    excerpt: pin.text,
  };
}

export function buildMoveSelection(
  jjChangeId: string | null,
  filePaths: string[],
  chatPins: ChatPin[],
): MoveSelection | null {
  if (!jjChangeId) return null;

  const uniqueFiles = [...new Set(filePaths.filter(Boolean))];
  const lineRanges = chatPins.map(lineRangeFromChatPin);

  if (uniqueFiles.length === 0 && lineRanges.length === 0) {
    return null;
  }

  return {
    jjChangeId,
    filePaths: uniqueFiles,
    lineRanges,
  };
}

export function isMoveSelectionEmpty(selection: MoveSelection | null): boolean {
  if (!selection) return true;
  return selection.filePaths.length === 0 && selection.lineRanges.length === 0;
}

export function moveSelectionLabel(selection: MoveSelection): string {
  const parts: string[] = [];
  if (selection.filePaths.length > 0) {
    parts.push(
      selection.filePaths.length === 1
        ? selection.filePaths[0]!
        : `${selection.filePaths.length} files`,
    );
  }
  if (selection.lineRanges.length > 0) {
    parts.push(
      selection.lineRanges.length === 1
        ? formatChatPinLabel(
            selection.lineRanges[0]!.filePath,
            selection.lineRanges[0]!.startLine,
            selection.lineRanges[0]!.endLine,
          )
        : `${selection.lineRanges.length} ranges`,
    );
  }
  return parts.join(" · ");
}

export function normalizeMoveSelectionPaths(
  selection: MoveSelection,
  allowedFiles: Set<string>,
): { filePaths: string[]; lineRanges: LineRangeSelection[] } {
  const filePathSet = new Set(selection.filePaths.filter((path) => allowedFiles.has(path)));

  for (const range of selection.lineRanges) {
    if (filePathSet.has(range.filePath)) continue;
    filePathSet.add(range.filePath);
  }

  const lineRanges = selection.lineRanges.filter((range) => {
    if (!allowedFiles.has(range.filePath)) return false;
    if (selection.filePaths.includes(range.filePath)) return false;
    return true;
  });

  return {
    filePaths: [...filePathSet].filter((path) =>
      selection.filePaths.includes(path),
    ),
    lineRanges,
  };
}

export type SplitToChangeRequest = {
  jjChangeId: string;
  description: string;
  filePaths: string[];
  lineRanges: Array<{
    filePath: string;
    side: "additions" | "deletions";
    startLine: number;
    endLine: number;
  }>;
};

export function toSplitToChangeRequest(
  selection: MoveSelection,
  description: string,
  allowedFiles: string[],
): SplitToChangeRequest {
  const allowed = new Set(allowedFiles);
  const normalized = normalizeMoveSelectionPaths(selection, allowed);

  if (normalized.filePaths.length === 0 && normalized.lineRanges.length === 0) {
    throw new Error("Selection must include files or line ranges from this change.");
  }

  return {
    jjChangeId: selection.jjChangeId,
    description: description.trim() || "Split from review",
    filePaths: normalized.filePaths,
    lineRanges: normalized.lineRanges.map(({ filePath, side, startLine, endLine }) => ({
      filePath,
      side,
      startLine,
      endLine,
    })),
  };
}
