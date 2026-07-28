import { createLLMProvider, type LLMProvider } from "../llm/provider";
import { PR_SUMMARY_SYSTEM_PROMPT } from "../llm/prompts/pr-summary";
import {
  fetchIssueComments,
  fetchPullDiff,
  fetchPullFiles,
  fetchPullMeta,
  type IssueComment,
  type PullFile,
} from "../watch/github";
import { formatDiffStatsFact } from "./diff-stats";
import { enrichSeverityDots } from "./severity";
import { validateSummary } from "./validate";

/**
 * Sessionless PR-summary generator for the OSS "watch" rail.
 *
 * Productionized from scripts/outreach.ts: same real PR_SUMMARY_SYSTEM_PROMPT,
 * same validators and severity enrichment, same honesty rule (no captured agent
 * sessions ⇒ attributions restricted to concrete diff paths and referenced PRs).
 * The only substantive change vs. the CLI is that the dossier is built from the
 * GitHub REST API with the bot token instead of the `gh` CLI, and generation
 * runs through the server's own LLM provider.
 */

const MAX_DIFF_CHARS = 14_000;

export type Coverage = {
  patchPct: string | null;
  missingFiles: string[];
};

export type ExternalDossier = {
  repoFullName: string;
  number: number;
  url: string;
  title: string;
  state: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: PullFile[];
  body: string;
  referencedPrs: number[];
  coverage: Coverage | null;
  diff: string;
};

export type ExternalSummary = {
  content: string;
  model: string;
  headSha: string;
};

function detectCoverage(comments: IssueComment[]): Coverage | null {
  const cc = comments.find(
    (c) => /codecov/i.test(c.author) || /Codecov Report/i.test(c.body),
  );
  if (!cc) return null;
  const patchPct = cc.body.match(/Patch coverage is `?([\d.]+%)/i)?.[1] ?? null;
  const missingFiles: string[] = [];
  for (const m of cc.body.matchAll(/\|\s*\[([^\]]+\.[a-z]+)\][^|]*\|\s*([\d.]+%)\s*\|/gi)) {
    if (parseFloat(m[2]!) < 90) {
      missingFiles.push(`${m[1]!.replace(/^\.\.\./, "").trim()} (${m[2]})`);
    }
  }
  return { patchPct, missingFiles };
}

export async function fetchExternalDossier(
  token: string,
  repoFullName: string,
  number: number,
): Promise<ExternalDossier> {
  const [meta, files, diff, comments] = await Promise.all([
    fetchPullMeta(token, repoFullName, number),
    fetchPullFiles(token, repoFullName, number),
    fetchPullDiff(token, repoFullName, number),
    fetchIssueComments(token, repoFullName, number),
  ]);

  const referencedPrs = [
    ...new Set(
      [...`${meta.body}\n${diff}`.matchAll(/#(\d{2,6})\b/g)].map((m) => Number(m[1])),
    ),
  ]
    .filter((n) => n !== number)
    .slice(0, 12);

  return {
    repoFullName,
    number,
    url: meta.htmlUrl,
    title: meta.title,
    state: meta.state,
    baseRef: meta.baseRef,
    headRef: meta.headRef,
    headSha: meta.headSha,
    additions: meta.additions,
    deletions: meta.deletions,
    changedFiles: meta.changedFiles,
    files,
    body: meta.body,
    referencedPrs,
    coverage: detectCoverage(comments),
    diff,
  };
}

/** Verbatim port of the outreach user prompt — the honesty + severity rules are load-bearing. */
function buildExternalUserPrompt(d: ExternalDossier): string {
  const files = d.files.map((f) => `- +${f.additions}/-${f.deletions} ${f.path}`).join("\n");
  const diff =
    d.diff.length > MAX_DIFF_CHARS ? d.diff.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated]" : d.diff;
  const lines = [
    `Repository: ${d.repoFullName} (public repo; external PR — no GX capture)`,
    `Pull request: #${d.number} — ${d.title}`,
    `State: ${d.state}; base ${d.baseRef} <- head ${d.headRef}`,
    // The shared system prompt takes its Blast Radius numbers from a "Diff
    // stats" line and omits the +X/-Y figure when there is none. GitHub already
    // reports exact totals for an external PR, so state them in that form
    // rather than leave the rail's accurate counts on the floor.
    formatDiffStatsFact({
      files: d.changedFiles,
      added: d.additions,
      removed: d.deletions,
      revisions: 1,
      perFile: d.files.map((f) => ({
        file: f.path,
        added: f.additions,
        removed: f.deletions,
      })),
    }),
    "", "Changed files:", files,
  ];
  if (d.referencedPrs.length) {
    lines.push("", `PRs referenced in the description/diff: ${d.referencedPrs.map((n) => `#${n}`).join(", ")}`);
  }
  if (d.coverage) {
    const miss = d.coverage.missingFiles.length
      ? `; low/no coverage on: ${d.coverage.missingFiles.join(", ")}`
      : "";
    lines.push("", `CI coverage signal: patch ${d.coverage.patchPct ?? "?"}${miss}`);
  }
  if (d.body.trim()) lines.push("", "Author-written PR description:", '"""', d.body.trim().slice(0, 3000), '"""');
  lines.push("", "Unified diff:", "```diff", diff, "```", "");
  lines.push(
    "IMPORTANT — this is an external PR with NO captured agent sessions and NO code index:",
    "- Do NOT use agent-sessions attribution and do NOT emit a \"Context provided\" line.",
    "- Attribute every Notable Change to one concrete source:",
    "  - codebase: a real path from the diff, optionally with a real line number",
    "    (`src/app.ts` or `src/app.ts:42`) — never the literal word \"line\"",
    "  - previous-prs: a `PR #N` actually referenced above",
    "  - heuristic: a concrete `path`",
    "",
    "Severity calibration (do not default to LOW just because the code looks clean):",
    "- Judge severity by BLAST RADIUS, not tidiness. A change to shared or security-sensitive",
    "  infrastructure (SSRF, auth, DNS, crypto, caching) that many call sites depend on, or a",
    "  critical guard/branch with low or no test coverage, is at least 🟡 MEDIUM even if correct.",
    "- Reserve 🟢 LOW for genuinely contained changes with no cross-cutting or runtime risk.",
    "",
    "Sharpen the review value:",
    "- If the description attributes the bug/regression to a prior PR (e.g. 'introduced in #N'),",
    "  include a Notable Change citing that PR via previous-prs attribution.",
    "- Include 1-2 Notable Changes a senior reviewer should VERIFY, each naming a SPECIFIC risk",
    "  with its evidence — e.g. an exact guard string that must stay in sync across two files, a",
    "  coverage number from the CI signal, or a concrete before/after change in an error path.",
    "  Do NOT write vague notes like 'ensure no side effects'.",
    "- Do not invent facts not supported by the diff, description, or coverage signal.",
    "",
    "Write the PR Summary now.",
  );
  return lines.join("\n");
}

/** Ensure the Quick scan line renders as a bold blockquote (render polish). */
function normalizeQuickScan(summary: string): string {
  return summary
    .split("\n")
    .map((line) => {
      if (!/quick\s+scan/i.test(line) || /^#{1,3}\s/.test(line.trim())) return line;
      let l = line.replace(/^\s+/, "");
      if (!l.startsWith(">")) l = `> ${l}`;
      if (!/\*\*\s*quick\s+scan\s*\*\*/i.test(l)) l = l.replace(/(quick\s+scan)/i, "**$1**");
      return l;
    })
    .join("\n");
}

function linkBase(): string {
  return process.env.GX_WATCH_LINK_BASE?.trim() || "https://gx.run/oss";
}

/**
 * Rewrite the model's own "*Generated by GX.*" line into the tracked footer.
 * Keeps the literal "*Generated by GX." prefix so validateSummary still passes,
 * and appends the per-repo/per-PR attribution link + the @gx call to action.
 */
export function applyTrackedFooter(
  content: string,
  repoFullName: string,
  prNumber: number,
  campaign: string,
): string {
  const params = new URLSearchParams({
    repo: repoFullName,
    pr: String(prNumber),
    utm_source: "github",
    utm_campaign: campaign,
  });
  const url = `${linkBase()}?${params.toString()}`;
  const footer = `*Generated by GX. [What is this?](${url}) — reply \`@gx <question>\` to ask about this PR.*`;

  const lines = content.split("\n");
  const idx = lines.findIndex((l) => /^\*?\s*generated by gx\.?\s*\*?$/i.test(l.trim()));
  if (idx >= 0) {
    lines[idx] = footer;
    return lines.join("\n");
  }
  return `${content.trimEnd()}\n\n${footer}`;
}

export async function generateExternalSummary(
  dossier: ExternalDossier,
  campaign: string,
  provider: LLMProvider = createLLMProvider(dossier.files.map((f) => f.path).slice(0, 3).join(", ")),
): Promise<ExternalSummary> {
  const user = buildExternalUserPrompt(dossier);

  let text = "";
  let model = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await provider.complete(PR_SUMMARY_SYSTEM_PROMPT, user);
    text = normalizeQuickScan(completion.text.trim());
    model = completion.model;
    if (validateSummary(text).ok) break;
  }

  const validation = validateSummary(text);
  if (!validation.ok) {
    throw new Error(`external summary failed validation: ${validation.error}`);
  }

  const content = applyTrackedFooter(
    enrichSeverityDots(text),
    dossier.repoFullName,
    dossier.number,
    campaign,
  );
  return { content, model, headSha: dossier.headSha };
}
