import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";

export type ChatPin = {
  id: string;
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  text: string;
  label: string;
};

export type ChatPinInput = {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  text: string;
};

function normalizeRange(range: SelectedLineRange): {
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
} {
  const side = range.side ?? "additions";
  const startLine = Math.min(range.start, range.end);
  const endLine = Math.max(range.start, range.end);
  return { side, startLine, endLine };
}

function lineTextAt(
  fileDiff: FileDiffMetadata,
  side: "additions" | "deletions",
  lineNumber: number,
): string | undefined {
  const lines = side === "additions" ? fileDiff.additionLines : fileDiff.deletionLines;

  for (const hunk of fileDiff.hunks) {
    let addLineNum = hunk.additionStart;
    let addLineIdx = hunk.additionLineIndex;
    let delLineNum = hunk.deletionStart;
    let delLineIdx = hunk.deletionLineIndex;

    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let index = 0; index < block.lines; index += 1) {
          if (side === "additions" && addLineNum === lineNumber) {
            return lines[addLineIdx];
          }
          if (side === "deletions" && delLineNum === lineNumber) {
            return lines[delLineIdx];
          }
          addLineNum += 1;
          addLineIdx += 1;
          delLineNum += 1;
          delLineIdx += 1;
        }
        continue;
      }

      for (let index = 0; index < block.deletions; index += 1) {
        if (side === "deletions" && delLineNum === lineNumber) {
          return lines[delLineIdx];
        }
        delLineNum += 1;
        delLineIdx += 1;
      }

      for (let index = 0; index < block.additions; index += 1) {
        if (side === "additions" && addLineNum === lineNumber) {
          return lines[addLineIdx];
        }
        addLineNum += 1;
        addLineIdx += 1;
      }
    }
  }

  return undefined;
}

export function extractSelectedDiffText(
  fileDiff: FileDiffMetadata,
  range: SelectedLineRange,
): { side: "additions" | "deletions"; lines: string[] } {
  const { side, startLine, endLine } = normalizeRange(range);
  const lines: string[] = [];

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    lines.push(lineTextAt(fileDiff, side, lineNumber) ?? "");
  }

  return { side, lines };
}

export function formatChatPinLabel(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  const lineLabel =
    startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
  return `${filePath}:${lineLabel}`;
}

export function chatPinFromDiffSelection(
  fileDiff: FileDiffMetadata,
  range: SelectedLineRange,
): ChatPin {
  const { side, lines } = extractSelectedDiffText(fileDiff, range);
  const { startLine, endLine } = normalizeRange(range);
  const text = lines.join("\n").trimEnd();

  return {
    id: `${fileDiff.name}:${side}:${startLine}-${endLine}`,
    filePath: fileDiff.name,
    side,
    startLine,
    endLine,
    text,
    label: formatChatPinLabel(fileDiff.name, startLine, endLine),
  };
}

export function chatPinFromPending(pending: {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  excerpt: string;
}): ChatPin {
  return {
    id: `${pending.filePath}:${pending.side}:${pending.startLine}-${pending.endLine}`,
    filePath: pending.filePath,
    side: pending.side,
    startLine: pending.startLine,
    endLine: pending.endLine,
    text: pending.excerpt,
    label: formatChatPinLabel(
      pending.filePath,
      pending.startLine,
      pending.endLine,
    ),
  };
}

export function chatPinToInput(pin: ChatPin): ChatPinInput {
  return {
    filePath: pin.filePath,
    side: pin.side,
    startLine: pin.startLine,
    endLine: pin.endLine,
    text: pin.text,
  };
}
