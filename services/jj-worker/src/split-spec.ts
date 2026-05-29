import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SplitLineRange } from "./types";

export type GxSplitSpec = {
  version: 1;
  description: string;
  entries: Array<{
    path: string;
    side: "additions" | "deletions";
    start_line: number;
    end_line: number;
  }>;
};

export function buildGxSplitSpec(
  description: string,
  lineRanges: SplitLineRange[],
): GxSplitSpec {
  return {
    version: 1,
    description,
    entries: lineRanges.map((range) => ({
      path: range.filePath,
      side: range.side,
      start_line: range.startLine,
      end_line: range.endLine,
    })),
  };
}

export async function writeGxSplitSpecFile(
  workspaceRoot: string,
  spec: GxSplitSpec,
): Promise<string> {
  const specPath = path.join(workspaceRoot, ".gx-split-spec.json");
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
  return specPath;
}

export function dedupeSplitPaths(
  filePaths: string[],
  lineRanges: SplitLineRange[],
): { filePaths: string[]; lineRanges: SplitLineRange[] } {
  const wholeFiles = new Set(filePaths);
  const partialRanges = lineRanges.filter((range) => !wholeFiles.has(range.filePath));
  return {
    filePaths: [...wholeFiles],
    lineRanges: partialRanges,
  };
}
