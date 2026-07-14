import type { FilePatch } from "./patch";

export type ReviewPriority = "critical" | "review" | "skim";

export type FileReviewPriority = {
  file: string;
  priority: ReviewPriority;
  reason: string;
  executableLineRatio: number;
};

type ChangedSymbol = {
  file?: string;
  kind?: string;
};

const GENERATED_PATH =
  /(^|\/)(_generated|generated|dist|node_modules)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|cargo\.lock|go\.sum)$|(\.d\.ts|\.gen\.[^.]+|\.snap|\.map|min\.(js|css))$/i;
const SUPPORTING_PATH =
  /(^|\/)(__fixtures__|fixtures|mocks?|stories)(\/|$)|\.(test|spec|stories)\.[^.]+$|_test\.[^.]+$|\.(css|scss|sass|less|md|mdx|svg)$/i;
const BOUNDARY_PATH =
  /(^|\/)(api|routes?|middleware|auth|migrations?|convex)(\/|$)|\.sql$/i;

function changedLines(patch?: FilePatch): string[] {
  if (!patch) return [];
  return patch.hunks.flatMap((hunk) =>
    hunk.lines
      .slice(1)
      .filter(
        (line) =>
          (line.startsWith("+") && !line.startsWith("+++")) ||
          (line.startsWith("-") && !line.startsWith("---")),
      )
      .map((line) => line.slice(1).trim()),
  );
}

function isNonExecutableLine(line: string): boolean {
  return (
    !line ||
    /^(\/\/|\/\*|\*|#)/.test(line) ||
    /^(import|export\s+\{)/.test(line) ||
    /^(export\s+)?(type|interface)\b/.test(line) ||
    /^[{}[\](),;]+$/.test(line)
  );
}

export function classifyFileForReview(
  file: string,
  patch?: FilePatch,
  symbols: ChangedSymbol[] = [],
): FileReviewPriority {
  if (GENERATED_PATH.test(file)) {
    return {
      file,
      priority: "skim",
      reason: "Generated or derived file; verify through its source change.",
      executableLineRatio: 0,
    };
  }

  const lines = changedLines(patch);
  const executableLines = lines.filter((line) => !isNonExecutableLine(line));
  const executableLineRatio =
    lines.length > 0 ? executableLines.length / lines.length : 0;
  const runtimeSymbol = symbols.some(
    (symbol) =>
      symbol.file === file &&
      /^(function|method|class|constructor|module)$/i.test(symbol.kind ?? ""),
  );
  const fileSymbols = symbols.filter((symbol) => symbol.file === file);
  const typeOnlySymbols =
    fileSymbols.length > 0 &&
    fileSymbols.every((symbol) =>
      /^(type|interface|enum|typealias)$/i.test(symbol.kind ?? ""),
    );

  if (BOUNDARY_PATH.test(file) && (runtimeSymbol || executableLineRatio > 0.15)) {
    return {
      file,
      priority: "critical",
      reason: "Runtime boundary, persistence, authentication, or migration logic.",
      executableLineRatio,
    };
  }

  if (SUPPORTING_PATH.test(file)) {
    return {
      file,
      priority: "skim",
      reason: "Supporting test, documentation, fixture, or presentation change.",
      executableLineRatio,
    };
  }

  if (
    typeOnlySymbols ||
    (lines.length > 0 && executableLineRatio < 0.15 && !runtimeSymbol)
  ) {
    return {
      file,
      priority: "skim",
      reason: "Predominantly type-only, import-only, or declarative changes.",
      executableLineRatio,
    };
  }

  return {
    file,
    priority: "review",
    reason: "Contains executable behavior that may affect runtime paths.",
    executableLineRatio,
  };
}
