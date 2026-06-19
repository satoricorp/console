export const REQUIRED_SECTIONS = [
  "Intent",
  "Read these",
  "Safe to skim",
  "Blast radius",
  "Agent friction",
  "Provenance",
] as const;

export type SummaryValidationError =
  | "too_many_lines"
  | "missing_section"
  | "contains_brief";

export type SummaryValidationResult =
  | { ok: true; lineCount: number }
  | { ok: false; error: SummaryValidationError; detail?: string };

function normalizeHeading(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function sectionPresent(text: string, heading: string): boolean {
  const target = heading.toLowerCase();
  for (const line of text.split("\n")) {
    const normalized = normalizeHeading(line.trim());
    if (normalized === target) {
      return true;
    }
  }
  return false;
}

/** Validate PR Summary: ≤20 lines, required sections, no "brief". */
export function validateSummary(text: string): SummaryValidationResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "missing_section", detail: "Intent" };
  }

  if (/\bbrief\b/i.test(trimmed)) {
    return { ok: false, error: "contains_brief" };
  }

  const lines = trimmed.split("\n");
  if (lines.length > 20) {
    return { ok: false, error: "too_many_lines", detail: String(lines.length) };
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!sectionPresent(trimmed, section)) {
      return { ok: false, error: "missing_section", detail: section };
    }
  }

  return { ok: true, lineCount: lines.length };
}

export function assertValidSummary(text: string): void {
  const result = validateSummary(text);
  if (!result.ok) {
    const detail = result.detail ? `: ${result.detail}` : "";
    throw new Error(`Invalid PR Summary (${result.error}${detail})`);
  }
}
