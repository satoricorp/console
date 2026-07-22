/** Traffic-light severity for PR Summary Quick scan + Blast Radius. */

export type BlastRadiusLevel = "LOW" | "MEDIUM" | "HIGH";

export const SEVERITY_DOT: Record<BlastRadiusLevel, string> = {
  LOW: "🟢",
  MEDIUM: "🟡",
  HIGH: "🔴",
};

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
 * Ensure Quick scan and Blast Radius carry a 🟢/🟡/🔴 matching the
 * detected LOW|MEDIUM|HIGH level. Idempotent; fixes wrong or missing dots.
 */
export function enrichSeverityDots(summary: string): string {
  const level = detectBlastRadiusLevel(summary);
  if (!level) return summary;
  const dot = SEVERITY_DOT[level];

  return summary
    .split("\n")
    .map((line) => {
      if (/Quick\s+scan/i.test(line)) {
        return ensureQuickScanDot(line, dot);
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

/** `> 🟢 👀 **Quick scan** — …` (dot before the eyes). */
function ensureQuickScanDot(line: string, dot: string): string {
  const idx = line.search(/Quick\s+scan/i);
  if (idx < 0) return line;
  const head = line.slice(0, idx).replace(SEVERITY_DOT_RE, "").replace(/  +/g, " ");
  const tail = line.slice(idx);
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
