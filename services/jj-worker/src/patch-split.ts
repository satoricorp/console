import type { SplitLineRange } from "./types";

type ParsedHunk = {
  filePath: string;
  header: string;
  body: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

type ParsedFileDiff = {
  filePath: string;
  preamble: string[];
  hunks: ParsedHunk[];
};

function normalizeDiffPath(path: string): string {
  return path
    .replace(/^\.\/+/, "")
    .replace(/^a\//, "")
    .replace(/^b\//, "")
    .trim();
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeDiffPath(left) === normalizeDiffPath(right);
}

function parseUnifiedDiffFiles(diff: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  const lines = diff.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.startsWith("diff --git ")) {
      index += 1;
      continue;
    }

    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    let filePath = normalizeDiffPath(match?.[2] ?? match?.[1] ?? "");
    const preamble: string[] = [line];
    index += 1;

    while (index < lines.length && !lines[index]!.startsWith("@@")) {
      const headerLine = lines[index]!;
      preamble.push(headerLine);
      if (headerLine.startsWith("+++ b/")) {
        filePath = normalizeDiffPath(headerLine.slice("+++ b/".length));
      } else if (headerLine.startsWith("+++ ")) {
        filePath = normalizeDiffPath(headerLine.slice(4));
      }
      index += 1;
    }

    const hunks: ParsedHunk[] = [];
    while (index < lines.length && lines[index]!.startsWith("@@")) {
      const header = lines[index]!;
      const hunkMatch = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!hunkMatch) {
        index += 1;
        continue;
      }
      const oldStart = Number(hunkMatch[1]);
      const oldCount = Number(hunkMatch[2] ?? "1");
      const newStart = Number(hunkMatch[3]);
      const newCount = Number(hunkMatch[4] ?? "1");
      index += 1;
      const bodyLines: string[] = [header];
      while (
        index < lines.length &&
        !lines[index]!.startsWith("@@") &&
        !lines[index]!.startsWith("diff --git ")
      ) {
        bodyLines.push(lines[index]!);
        index += 1;
      }
      hunks.push({
        filePath,
        header,
        body: bodyLines.join("\n"),
        oldStart,
        oldCount,
        newStart,
        newCount,
      });
    }

    if (filePath && hunks.length > 0) {
      files.push({ filePath, preamble, hunks });
    }
  }

  return files;
}

function hunkMatchesRange(
  hunk: ParsedHunk,
  range: SplitLineRange,
): boolean {
  if (!pathsEqual(hunk.filePath, range.filePath)) return false;
  const lineStart = range.side === "additions" ? hunk.newStart : hunk.oldStart;
  const lineEnd =
    lineStart +
    (range.side === "additions" ? hunk.newCount : hunk.oldCount) -
    1;
  return range.startLine <= lineEnd && range.endLine >= lineStart;
}

function renderFileDiff(file: ParsedFileDiff, hunks: ParsedHunk[]): string {
  if (hunks.length === 0) return "";
  const parts = [...file.preamble];
  for (const hunk of hunks) {
    parts.push(hunk.body);
  }
  return `${parts.join("\n")}\n`;
}

function buildDiffFromFiles(
  files: ParsedFileDiff[],
  pickHunks: (file: ParsedFileDiff) => ParsedHunk[],
): string {
  const parts: string[] = [];
  for (const file of files) {
    const picked = pickHunks(file);
    if (picked.length === 0) continue;
    parts.push(renderFileDiff(file, picked));
  }
  return parts.join("");
}

export function buildSelectedDiff(
  diff: string,
  lineRanges: SplitLineRange[],
): string {
  if (lineRanges.length === 0) return "";

  return buildDiffFromFiles(parseUnifiedDiffFiles(diff), (file) =>
    file.hunks.filter((hunk) =>
      lineRanges.some((range) => hunkMatchesRange(hunk, range)),
    ),
  );
}

export function buildRemainingDiff(
  diff: string,
  lineRanges: SplitLineRange[],
): string {
  if (lineRanges.length === 0) return diff;

  return buildDiffFromFiles(parseUnifiedDiffFiles(diff), (file) =>
    file.hunks.filter(
      (hunk) => !lineRanges.some((range) => hunkMatchesRange(hunk, range)),
    ),
  );
}
