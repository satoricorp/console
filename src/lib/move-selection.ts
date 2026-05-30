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
