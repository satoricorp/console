/** Traffic-light severity for the PR Summary verdict line + Blast Radius. */

export type BlastRadiusLevel = "LOW" | "MEDIUM" | "HIGH";

export const SEVERITY_DOT: Record<BlastRadiusLevel, string> = {
  LOW: "🟢",
  MEDIUM: "🟡",
  HIGH: "🔴",
};

// The verdict label states what the dot means. "Quick scan" next to a 🔴 reads
// as permission to skim — the opposite of what HIGH asks of the reader — so
// the label must agree with the level, not just the color.
export const SEVERITY_VERDICT: Record<BlastRadiusLevel, string> = {
  LOW: "Quick scan",
  MEDIUM: "Careful pass",
  HIGH: "Deep review",
};

const VERDICT_LABEL_RE = /(?:quick\s+scan|careful\s+pass|deep\s+review)/i;

/** Alternation (not a char class) so surrogate-pair emoji stay intact. */
const SEVERITY_DOT_RE = /(?:🟢|🟡|🔴)/gu;
const LEADING_SEVERITY_DOT_RE = /^(\s*)(?:🟢|🟡|🔴)?\s*(LOW|MEDIUM|HIGH)(\b.*)$/iu;

/** Detect LOW / MEDIUM / HIGH from the Blast Radius section (or first match). */
export function detectBlastRadiusLevel(
  summary: string,
): BlastRadiusLevel | null {
  const lines = summary.split("\n");
  let inBlast = false;

  for (const line of lines) {
    const heading = normalizeHeading(line);
    if (heading === "blast radius") {
      inBlast = true;
      continue;
    }
    if (inBlast) {
      if (/^#{1,3}\s+\S/.test(line.trim())) break;
      const level = matchLevel(line);
      if (level) return level;
    }
  }

  return matchLevel(summary);
}

/**
 * Ensure the verdict line and Blast Radius carry a 🟢/🟡/🔴 matching the
 * detected LOW|MEDIUM|HIGH level, and that the verdict label (Quick scan /
 * Careful pass / Deep review) agrees with it. Idempotent; fixes wrong or
 * missing dots and labels.
 */
export function enrichSeverityDots(summary: string): string {
  const level = detectBlastRadiusLevel(summary);
  if (!level) return summary;
  const dot = SEVERITY_DOT[level];

  return summary
    .split("\n")
    .map((line) => {
      if (VERDICT_LABEL_RE.test(line)) {
        return ensureVerdictLine(line, dot, SEVERITY_VERDICT[level]);
      }
      if (matchLevel(line)) {
        return ensureLevelDot(line, dot, level);
      }
      return line;
    })
    .join("\n");
}

function normalizeHeading(line: string): string {
  return line
    .trim()
    .replace(SEVERITY_DOT_RE, "")
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function matchLevel(text: string): BlastRadiusLevel | null {
  const m = text.match(/\b(LOW|MEDIUM|HIGH)\b/i);
  if (!m) return null;
  return m[1]!.toUpperCase() as BlastRadiusLevel;
}

/** `> 🟢 👀 **Quick scan** — …` (dot before the eyes, label matching the level). */
function ensureVerdictLine(line: string, dot: string, verdict: string): string {
  const idx = line.search(VERDICT_LABEL_RE);
  if (idx < 0) return line;
  const head = line.slice(0, idx).replace(SEVERITY_DOT_RE, "").replace(/  +/g, " ");
  // Replacing only the matched label keeps whatever bolding wraps it.
  const tail = line.slice(idx).replace(VERDICT_LABEL_RE, verdict);
  if (head.includes("👀")) {
    return head.replace("👀", `${dot} 👀`) + tail;
  }
  return `${head}${dot} ${tail}`;
}

/** `🟢 LOW (…)` — strip any prior dots, pin the correct one + canonical level. */
function ensureLevelDot(
  line: string,
  dot: string,
  level: BlastRadiusLevel,
): string {
  const m = LEADING_SEVERITY_DOT_RE.exec(line);
  if (!m) return line;
  return `${m[1]}${dot} ${level}${m[3]}`;
}
