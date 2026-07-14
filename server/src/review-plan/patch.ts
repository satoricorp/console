export type UnifiedHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
};

export type FilePatch = {
  file: string;
  oldFile: string | null;
  newFile: string | null;
  isBinary: boolean;
  hunks: UnifiedHunk[];
  /** Full file patch text including headers */
  text: string;
};

export const MAX_NOTABLE_NEW_LINES = 24;
const MAX_NOTABLE_BODY_LINES = 30;
const NOTABLE_CONTEXT_LINES = 3;

const SKIP_PATH_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|.*\.min\.(js|css)|.*\.map)$/i;

export function shouldSkipGeneratedPath(file: string): boolean {
  return SKIP_PATH_RE.test(file) || file.includes("/node_modules/") || file.includes("/dist/");
}

/**
 * Split a unified diff into per-file patches. Bun-native; do not pull @pierre/diffs.
 */
export function splitUnifiedDiff(patch: string): FilePatch[] {
  if (!patch.trim()) return [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: FilePatch[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i]?.startsWith("diff --git ")) {
      i += 1;
      continue;
    }

    const start = i;
    const headerLine = lines[i] ?? "";
    i += 1;

    let oldFile: string | null = null;
    let newFile: string | null = null;
    let isBinary = false;
    const hunks: UnifiedHunk[] = [];

    while (i < lines.length && !lines[i]?.startsWith("diff --git ")) {
      const line = lines[i] ?? "";
      if (line.startsWith("--- ")) {
        oldFile = stripPrefix(line.slice(4));
      } else if (line.startsWith("+++ ")) {
        newFile = stripPrefix(line.slice(4));
      } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
        isBinary = true;
      } else if (line.startsWith("@@")) {
        const hunk = parseHunk(lines, i);
        hunks.push(hunk.hunk);
        i = hunk.nextIndex;
        continue;
      }
      i += 1;
    }

    const text = lines.slice(start, i).join("\n");
    const file =
      (newFile && newFile !== "/dev/null" ? newFile : null) ||
      (oldFile && oldFile !== "/dev/null" ? oldFile : null) ||
      parseDiffGitPaths(headerLine).newPath ||
      parseDiffGitPaths(headerLine).oldPath ||
      "unknown";

    files.push({
      file,
      oldFile,
      newFile,
      isBinary,
      hunks,
      text,
    });
  }

  return files;
}

function stripPrefix(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/dev/null") return trimmed;
  // a/foo or b/foo
  if (/^[ab]\//.test(trimmed)) return trimmed.slice(2);
  return trimmed;
}

function parseDiffGitPaths(header: string): { oldPath: string | null; newPath: string | null } {
  // diff --git a/foo b/foo
  const match = header.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return { oldPath: null, newPath: null };
  return { oldPath: match[1] ?? null, newPath: match[2] ?? null };
}

function parseHunk(
  lines: string[],
  startIndex: number,
): { hunk: UnifiedHunk; nextIndex: number } {
  const header = lines[startIndex] ?? "";
  const match = header.match(
    /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/,
  );
  const oldStart = match ? Number(match[1]) : 0;
  const oldLines = match ? Number(match[2] ?? "1") : 0;
  const newStart = match ? Number(match[3]) : 0;
  const newLines = match ? Number(match[4] ?? "1") : 0;

  const hunkLines: string[] = [header];
  let i = startIndex + 1;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("@@") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      break;
    }
    if (
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ") ||
      line === "\\ No newline at end of file"
    ) {
      hunkLines.push(line);
      i += 1;
      continue;
    }
    // Unexpected line — stop hunk
    break;
  }

  return {
    hunk: {
      oldStart,
      oldLines,
      newStart,
      newLines,
      header,
      lines: hunkLines,
    },
    nextIndex: i,
  };
}

/** New-file line ranges covered by hunks (inclusive). */
export function newLineRanges(file: FilePatch): Array<{ start: number; end: number }> {
  return file.hunks
    .filter((h) => h.newLines > 0)
    .map((h) => ({
      start: h.newStart,
      end: h.newStart + Math.max(h.newLines, 1) - 1,
    }));
}

export function rangesIntersect(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Slice a file patch to hunks that intersect [lineStart, lineEnd] on the new side.
 * Falls back to the full file patch when no line range is given.
 */
export function sliceFilePatch(
  file: FilePatch,
  lineStart?: number,
  lineEnd?: number,
): string {
  if (file.hunks.length === 0) {
    return file.text;
  }
  const fallbackHunk =
    file.hunks.find((hunk) => hunk.newLines > 0) ?? file.hunks[0]!;
  const hasUsableRange =
    Number.isInteger(lineStart) &&
    Number.isInteger(lineEnd) &&
    lineStart! >= 1 &&
    lineEnd! >= lineStart!;
  const start = hasUsableRange ? lineStart! : Math.max(1, fallbackHunk.newStart);
  const target = {
    start,
    end: hasUsableRange
      ? Math.min(lineEnd!, start + MAX_NOTABLE_NEW_LINES - 1)
      : start + MAX_NOTABLE_NEW_LINES - 1,
  };
  const matching = file.hunks.find((hunk) =>
    rangesIntersect(
      {
        start: hunk.newStart,
        end: hunk.newStart + Math.max(hunk.newLines, 1) - 1,
      },
      target,
    ),
  );
  const selectedHunk = matching ?? fallbackHunk;
  const selectedTarget = matching
    ? target
    : {
        start: Math.max(1, fallbackHunk.newStart),
        end: Math.max(1, fallbackHunk.newStart) + MAX_NOTABLE_NEW_LINES - 1,
      };

  const headerLines = file.text.split("\n").filter(
    (line) =>
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity") ||
      line.startsWith("rename"),
  );

  return [
    ...headerLines,
    ...sliceHunk(selectedHunk, selectedTarget, NOTABLE_CONTEXT_LINES),
  ].join("\n");
}

function sliceHunk(
  hunk: UnifiedHunk,
  target: { start: number; end: number },
  contextLines: number,
): string[] {
  const displayStart = Math.max(hunk.newStart, target.start - contextLines);
  const hunkEnd = hunk.newStart + Math.max(hunk.newLines, 1) - 1;
  const displayEnd = Math.min(hunkEnd, target.end + contextLines);
  const body = hunk.lines.slice(1);
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  let first = -1;
  let last = -1;
  let sliceOldStart = oldLine;
  let sliceNewStart = newLine;

  for (let index = 0; index < body.length; index += 1) {
    const line = body[index] ?? "";
    const position = newLine;
    const inRange = position >= displayStart && position <= displayEnd;
    if (inRange && line !== "\\ No newline at end of file") {
      if (first < 0) {
        first = index;
        sliceOldStart = oldLine;
        sliceNewStart = newLine;
      }
      last = index;
    }
    if (line.startsWith("+")) {
      newLine += 1;
    } else if (line.startsWith("-")) {
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }

  if (first < 0 || last < first) return hunk.lines;
  if (
    body[last + 1] === "\\ No newline at end of file" &&
    last + 1 < body.length
  ) {
    last += 1;
  }
  const selected = body.slice(first, last + 1).slice(0, MAX_NOTABLE_BODY_LINES);
  let oldCount = 0;
  let newCount = 0;
  for (const line of selected) {
    if (line.startsWith(" ") || line.startsWith("-")) oldCount += 1;
    if (line.startsWith(" ") || line.startsWith("+")) newCount += 1;
  }
  const suffix = hunk.header.match(/@@[^@]*@@(.*)$/)?.[1] ?? "";
  return [
    `@@ -${sliceOldStart},${oldCount} +${sliceNewStart},${newCount} @@${suffix}`,
    ...selected,
  ];
}

export function capFilePatches(
  files: FilePatch[],
  opts?: { maxLinesPerFile?: number; maxTotalLines?: number },
): FilePatch[] {
  const maxLinesPerFile = opts?.maxLinesPerFile ?? 300;
  const maxTotalLines = opts?.maxTotalLines ?? 6000;
  let total = 0;
  const out: FilePatch[] = [];

  for (const file of files) {
    if (shouldSkipGeneratedPath(file.file) || file.isBinary) continue;
    const lines = file.text.split("\n");
    let text = file.text;
    if (lines.length > maxLinesPerFile) {
      text = [...lines.slice(0, maxLinesPerFile), `… (${lines.length - maxLinesPerFile} lines omitted)`].join(
        "\n",
      );
    }
    const used = text.split("\n").length;
    if (total + used > maxTotalLines) break;
    total += used;
    out.push({ ...file, text });
  }
  return out;
}
