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
  if (lineStart == null || lineEnd == null || file.hunks.length === 0) {
    return file.text;
  }
  const target = { start: lineStart, end: lineEnd };
  const matching = file.hunks.filter((h) =>
    rangesIntersect(
      { start: h.newStart, end: h.newStart + Math.max(h.newLines, 1) - 1 },
      target,
    ),
  );
  if (matching.length === 0) return file.text;

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

  return [...headerLines, ...matching.flatMap((h) => h.lines)].join("\n");
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
