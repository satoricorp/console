import type { HunkLinkInput } from "../types";

/** Parse `commitSHA:file/path:1-N` hunk IDs from the Go matcher. */
export function resolveHunkFileLines(link: HunkLinkInput): {
  file: string;
  lineStart: number;
  lineEnd: number;
} {
  if (link.file && link.lineStart != null && link.lineEnd != null) {
    return {
      file: link.file,
      lineStart: link.lineStart,
      lineEnd: link.lineEnd,
    };
  }

  const parts = link.hunkID.split(":");
  if (parts.length < 3) {
    return { file: link.hunkID, lineStart: 1, lineEnd: 1 };
  }

  const linePart = parts[parts.length - 1];
  const file = parts.slice(1, -1).join(":");
  const dash = linePart.indexOf("-");
  if (dash === -1) {
    const n = parseInt(linePart, 10);
    return { file, lineStart: n || 1, lineEnd: n || 1 };
  }
  const start = parseInt(linePart.slice(0, dash), 10) || 1;
  const end = parseInt(linePart.slice(dash + 1), 10) || start;
  return { file, lineStart: start, lineEnd: end };
}
