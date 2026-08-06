#!/usr/bin/env bun
/**
 * gx outreach PR-summary generator.
 *
 * Turns a PUBLIC GitHub PR into a faithful gx PR summary (`summary.md`) and a
 * clean, attachable `summary.pdf` — for cold outreach to OSS companies. There is
 * no gx capture pipeline here: no DB, no index, no agent-session data. It works
 * from the public diff + PR metadata via `gh`, and reuses the REAL production
 * summary prompt + validators so the format matches what gx writes into PR
 * bodies. It never fabricates provenance (no captured sessions ⇒ attributions
 * are restricted to concrete diff paths and PRs referenced in the change).
 *
 * Read-only; posts nothing to GitHub.
 *
 * Usage (from the repo root):
 *   bun scripts/outreach.ts gen https://github.com/bitwarden/server/pull/8036
 *   bun scripts/outreach.ts gen --file targets.txt      # one PR URL per line
 *   bun scripts/outreach.ts scout bitwarden dualentry   # find repo + best PR + bot
 *   bun scripts/outreach.ts models                      # list OpenAI models a key can use
 *
 * Provider (first available; override model with OUTREACH_MODEL):
 *   OPENAI_API_KEY     -> OpenAI /responses (default gpt-5). Send-grade needs a
 *                         REASONING model — gpt-4o/gpt-4.1 miss subtle diff risks.
 *   ANTHROPIC_API_KEY  -> Anthropic Messages API (default claude-opus-4-8)
 *
 * PDF: rendered with headless Chrome (auto-detected; set CHROME_PATH to override).
 * Requires: `gh` CLI authenticated (gh auth status).
 */

import { existsSync, mkdtempSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PR_SUMMARY_SYSTEM_PROMPT } from "../server/src/llm/prompts/pr-summary";
import { validateSummary } from "../server/src/summary/validate";
import { enrichSeverityDots } from "../server/src/summary/severity";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

/** Load KEY=VALUE pairs from repo dotenv files into process.env (no override). */
async function loadEnv(): Promise<void> {
  const here = new URL(".", import.meta.url).pathname; // scripts/
  for (const path of [`${here}../.env.local`, `${here}../.env`, `${here}../server/.env`]) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    for (const raw of (await file.text()).split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

type PrRef = { owner: string; repo: string; number: number };
type ChangedFile = { path: string; additions: number; deletions: number };
type CompetitorReview = { name: string; login: string; verdict: string | null; body: string };
type Coverage = { patchPct: string | null; projectPct: string | null; missingFiles: string[] };
type RawComment = { author: { login: string } | null; body: string };

type Dossier = {
  ref: PrRef; url: string; title: string; author: string; state: string;
  baseRefName: string; headRefName: string;
  additions: number; deletions: number; changedFiles: number;
  files: ChangedFile[]; body: string; referencedPrs: number[];
  competitor: CompetitorReview | null; coverage: Coverage | null; diff: string;
};

// ---------------------------------------------------------------------------
// gh helpers
// ---------------------------------------------------------------------------

function gh(args: string[]): string {
  const proc = Bun.spawnSync(["gh", ...args]);
  if (proc.exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${proc.stderr.toString().trim() || `exit ${proc.exitCode}`}`);
  }
  return proc.stdout.toString();
}

function parsePrRef(input: string): PrRef {
  const url = input.trim();
  let m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (m) return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
  m = url.match(/^([^/\s]+)\/([^/#\s]+)#(\d+)$/);
  if (m) return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
  throw new Error(`Not a PR URL or owner/repo#N: ${input}`);
}

function fetchComments(repo: string, number: number): RawComment[] {
  try {
    return (JSON.parse(gh(["pr", "view", String(number), "--repo", repo, "--json", "comments"])) as { comments: RawComment[] }).comments;
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// competitor bot + coverage detection (competitor is used by `scout`)
// ---------------------------------------------------------------------------

const KNOWN_BOTS: Array<{ name: string; re: RegExp }> = [
  { name: "CodeRabbit", re: /coderabbit/i }, { name: "Greptile", re: /greptile/i },
  { name: "Ellipsis", re: /ellipsis/i }, { name: "Sourcery", re: /sourcery/i },
  { name: "Qodo / CodiumAI", re: /qodo|codium/i }, { name: "Cursor Bugbot", re: /cursor/i },
  { name: "Bugbot", re: /bugbot/i }, { name: "Devin", re: /devin/i },
  { name: "Graphite Reviewer", re: /graphite/i }, { name: "GitHub Copilot", re: /copilot/i },
  { name: "Entelligence", re: /entelligence/i },
];
const REVIEW_MARKERS = /overall assessment|code review|automated review|reviewed the|findings?\b|approve\b|request changes|<!--\s*[a-z-]*code-review/i;

function detectCompetitor(comments: RawComment[]): CompetitorReview | null {
  const candidates = comments
    .filter((c) => {
      const login = c.author?.login ?? "";
      if (/codecov|dependabot|renovate/i.test(login)) return false;
      if (/generated by gx|<!--\s*gx:/i.test(c.body)) return false;
      return true;
    })
    .map((c) => {
      const login = c.author?.login ?? "";
      const known = KNOWN_BOTS.find((b) => b.re.test(`${login}\n${c.body}`));
      const score = (known ? 3 : 0) + (REVIEW_MARKERS.test(c.body) ? 2 : 0) +
        (/\[bot\]|-bot|bot$|github-actions|-ai\b|ai-/i.test(login) ? 1 : 0);
      return { c, login, known, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);

  const top = candidates[0];
  if (!top) return null;
  const verdict =
    top.c.body.match(/overall assessment[:*\s]+([A-Za-z ]+?)(?:\n|<|\*)/i)?.[1]?.trim() ||
    top.c.body.match(/\b(APPROVE|REQUEST CHANGES|COMMENT|LGTM|BLOCK)\b/)?.[1] || null;
  return { name: top.known?.name ?? nameFromBody(top.login, top.c.body), login: top.login, verdict, body: top.c.body };
}

function nameFromBody(login: string, body: string): string {
  const heading = body.match(/^#{1,3}\s*(.+)$/m)?.[1] || body.match(/^\*\*(.+?)\*\*/m)?.[1];
  if (heading) {
    const clean = heading.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/`/g, "").trim();
    if (clean && clean.length <= 60) return clean;
  }
  return /github-actions/i.test(login) ? "the automated review action" : login || "the automated reviewer";
}

function detectCoverage(comments: RawComment[]): Coverage | null {
  const cc = comments.find((c) => /codecov/i.test(c.author?.login ?? "") || /Codecov Report/i.test(c.body));
  if (!cc) return null;
  const patchPct = cc.body.match(/Patch coverage is `?([\d.]+%)/i)?.[1] ?? null;
  const projectPct = cc.body.match(/Project coverage is ([\d.]+%)/i)?.[1] ?? null;
  const missingFiles: string[] = [];
  for (const m of cc.body.matchAll(/\|\s*\[([^\]]+\.[a-z]+)\][^|]*\|\s*([\d.]+%)\s*\|/gi)) {
    if (parseFloat(m[2]!) < 90) missingFiles.push(`${m[1]!.replace(/^\.\.\./, "").trim()} (${m[2]})`);
  }
  return { patchPct, projectPct, missingFiles };
}

function fetchDossier(ref: PrRef): Dossier {
  const repo = `${ref.owner}/${ref.repo}`;
  const meta = JSON.parse(gh([
    "pr", "view", String(ref.number), "--repo", repo, "--json",
    "title,body,author,additions,deletions,changedFiles,files,url,baseRefName,headRefName,state,comments",
  ])) as {
    title: string; body: string | null; author: { login: string } | null;
    additions: number; deletions: number; changedFiles: number;
    files: Array<{ path: string; additions: number; deletions: number }>;
    url: string; baseRefName: string; headRefName: string; state: string; comments: RawComment[];
  };
  const diff = gh(["pr", "diff", String(ref.number), "--repo", repo]);
  const body = meta.body ?? "";
  const referencedPrs = [...new Set([...`${body}\n${diff}`.matchAll(/#(\d{2,6})\b/g)].map((m) => Number(m[1])))]
    .filter((n) => n !== ref.number).slice(0, 12);
  return {
    ref, url: meta.url, title: meta.title, author: meta.author?.login ?? "unknown", state: meta.state,
    baseRefName: meta.baseRefName, headRefName: meta.headRefName,
    additions: meta.additions, deletions: meta.deletions, changedFiles: meta.changedFiles,
    files: meta.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    body, referencedPrs, competitor: detectCompetitor(meta.comments), coverage: detectCoverage(meta.comments), diff,
  };
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

type LLMProvider = { label: string; complete(system: string, user: string): Promise<string> };
const MAX_DIFF_CHARS = 14_000;

function anthropicProvider(): LLMProvider | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.OUTREACH_MODEL?.trim() || "claude-opus-4-8";
  return {
    label: `Anthropic ${model}`,
    async complete(system, user) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      const text = (json.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("").trim();
      if (!text) throw new Error("Anthropic returned empty content");
      return text;
    },
  };
}

/** OpenAI /responses, reasoning-aware: o-series/gpt-5 get a big token budget
 * (reasoning tokens share the cap) + a reasoning effort. Model from OUTREACH_MODEL. */
function openaiProvider(): LLMProvider | null {
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.GX_OPENAI_API_KEY?.trim();
  if (!key || key === "mock") return null;
  const model = process.env.OUTREACH_MODEL?.trim() || "gpt-5";
  const reasoning = /^(o[0-9]|gpt-5)/i.test(model);
  return {
    label: `OpenAI ${model}`,
    async complete(system, user) {
      const payload: Record<string, unknown> = {
        model, instructions: system, input: user, max_output_tokens: reasoning ? 8000 : 1500,
      };
      if (reasoning) payload.reasoning = { effort: "medium" };
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const json = (await res.json()) as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
      const text = json.output_text?.trim() ||
        (json.output ?? []).flatMap((o) => o.content ?? [])
          .filter((c) => c.type === "output_text").map((c) => c.text).join("").trim() || "";
      if (!text) throw new Error("OpenAI returned empty content (reasoning may have used the whole token budget)");
      return text;
    },
  };
}

function resolveProvider(): { provider: LLMProvider | null; note: string } {
  const a = anthropicProvider();
  if (a) return { provider: a, note: a.label };
  const o = openaiProvider();
  if (o) return { provider: o, note: o.label };
  return { provider: null, note: "no ANTHROPIC_API_KEY / OPENAI_API_KEY — writing prompt.txt only" };
}

async function cmdModels(): Promise<void> {
  await loadEnv();
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.GX_OPENAI_API_KEY?.trim();
  if (!key) { console.log("No OPENAI_API_KEY found in env."); return; }
  const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) { console.log(`models list failed: ${res.status} ${(await res.text()).slice(0, 200)}`); return; }
  const ids = ((await res.json()) as { data: Array<{ id: string }> }).data
    .map((m) => m.id).filter((id) => /^(o[0-9]|gpt-4|gpt-5|chatgpt)/i.test(id)).sort();
  console.log("Chat/reasoning models this key can use:\n" + ids.map((i) => "  " + i).join("\n"));
}

// ---------------------------------------------------------------------------
// summary generation
// ---------------------------------------------------------------------------

function buildSummaryUserPrompt(d: Dossier): string {
  const files = d.files.map((f) => `- +${f.additions}/-${f.deletions} ${f.path}`).join("\n");
  const diff = d.diff.length > MAX_DIFF_CHARS ? d.diff.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated]" : d.diff;
  const lines = [
    `Repository: ${d.ref.owner}/${d.ref.repo} (public repo; external PR — no gx capture)`,
    `Pull request: #${d.ref.number} — ${d.title}`,
    `State: ${d.state}; base ${d.baseRefName} <- head ${d.headRefName}`,
    `File stats: ${JSON.stringify({ changedFiles: d.changedFiles, additions: d.additions, deletions: d.deletions })}`,
    "", "Changed files:", files,
  ];
  if (d.referencedPrs.length) lines.push("", `PRs referenced in the description/diff: ${d.referencedPrs.map((n) => `#${n}`).join(", ")}`);
  if (d.coverage) {
    const miss = d.coverage.missingFiles.length ? `; low/no coverage on: ${d.coverage.missingFiles.join(", ")}` : "";
    lines.push("", `CI coverage signal: patch ${d.coverage.patchPct ?? "?"}${miss}`);
  }
  if (d.body.trim()) lines.push("", "Author-written PR description:", '"""', d.body.trim().slice(0, 3000), '"""');
  lines.push("", "Unified diff:", "```diff", diff, "```", "");
  lines.push(
    "IMPORTANT — this is an external PR with NO captured agent sessions and NO code index:",
    "- Do NOT use agent-sessions attribution and do NOT emit a \"Context provided\" line.",
    "- Attribute every Notable Change to one concrete source:",
    "  - codebase: a `path` or `path:line` taken from the diff",
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

/** Ensure the verdict line is a blockquote with a bold label (render polish). */
const VERDICT_LINE_RE = /(quick\s+scan|careful\s+pass|deep\s+review)/i;
function normalizeQuickScan(summary: string): string {
  return summary.split("\n").map((line) => {
    if (!VERDICT_LINE_RE.test(line) || /^#{1,3}\s/.test(line.trim())) return line;
    let l = line.replace(/^\s+/, "");
    if (!l.startsWith(">")) l = `> ${l}`;
    if (!/\*\*\s*(quick\s+scan|careful\s+pass|deep\s+review)\s*\*\*/i.test(l)) {
      l = l.replace(VERDICT_LINE_RE, "**$1**");
    }
    return l;
  }).join("\n");
}

async function generateSummary(provider: LLMProvider, d: Dossier): Promise<string> {
  const user = buildSummaryUserPrompt(d);
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const enriched = enrichSeverityDots(normalizeQuickScan((await provider.complete(PR_SUMMARY_SYSTEM_PROMPT, user)).trim()));
    const v = validateSummary(enriched);
    if (v.ok) return enriched;
    last = `${enriched}\n\n<!-- invalid summary: ${v.error}${v.detail ? ` (${v.detail})` : ""} -->`;
  }
  return last;
}

// ---------------------------------------------------------------------------
// PDF rendering (styled HTML -> headless Chrome)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** Render the constrained summary markdown into styled HTML blocks. */
function summaryBlocksToHtml(summary: string): string {
  const out: string[] = [];
  let ul = false, sub = false;
  const closeSub = () => { if (sub) { out.push("</ul>"); sub = false; } };
  const closeUl = () => { closeSub(); if (ul) { out.push("</ul>"); ul = false; } };
  for (const raw of summary.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^\*?\s*generated by gx\.?\s*\*?$/i.test(line.trim())) continue; // own footer below
    const isQuick = /quick\s+scan/i.test(line) && !line.startsWith("#");
    if (line.startsWith(">") || isQuick) {
      closeUl();
      let c = line.replace(/^>\s?/, "");
      if (!/\*\*/.test(c)) c = c.replace(/(quick\s+scan)/i, "**$1**");
      out.push(`<div class="quick">${inline(c)}</div>`);
    } else if (/^#{2,3}\s/.test(line)) {
      closeUl();
      out.push(`<h2>${inline(line.replace(/^#{2,3}\s/, ""))}</h2>`);
    } else if (/^\s*Attribution:/i.test(line)) {
      closeSub();
      out.push(`<div class="attr">${inline(line.trim())}</div>`);
    } else if (/^\s{2,}[-*]\s/.test(line)) {
      if (!sub) { out.push('<ul class="sub">'); sub = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s/, ""))}</li>`);
    } else if (/^[-*]\s/.test(line)) {
      closeSub();
      if (!ul) { out.push("<ul>"); ul = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s/, ""))}</li>`);
    } else if ((ul || sub) && /^\s{2,}\S/.test(line)) {
      out.push(`<div class="cont">${inline(line.trim())}</div>`);
    } else {
      closeUl();
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  closeUl();
  return out.join("\n");
}

function summaryToDocHtml(d: Dossier, summary: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter; margin: 46px 52px; }
  * { box-sizing: border-box; }
  html { background:#ffffff; color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#111827; background:#ffffff; font-size:12.5px; line-height:1.55; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .doc { max-width: 700px; margin: 0 auto; }
  .head { border-bottom:2px solid #111827; padding-bottom:11px; margin-bottom:6px; }
  .brand { font-weight:800; letter-spacing:.08em; font-size:11px; color:#6b7280; text-transform:uppercase; }
  .title { font-size:18px; font-weight:700; margin:5px 0 3px; line-height:1.3; }
  .meta { font-size:11px; color:#6b7280; }
  .meta a { color:#2563eb; text-decoration:none; }
  .quick { border-left:4px solid #9ca3af; background:#f9fafb; padding:9px 13px; border-radius:6px; margin:14px 0; font-size:13.5px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#374151; border-bottom:1px solid #e5e7eb; padding-bottom:3px; margin:20px 0 9px; }
  p { margin:9px 0; }
  ul { margin:8px 0; padding-left:20px; }
  ul.sub { margin:2px 0 2px 4px; }
  li { margin:5px 0; }
  code { background:#f3f4f6; padding:1px 5px; border-radius:4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:88%; }
  .attr { font-size:10.5px; color:#6b7280; margin:1px 0 7px 4px; }
  .cont { font-size:11.5px; color:#4b5563; margin:1px 0 4px 6px; }
  .foot { margin-top:22px; padding-top:9px; border-top:1px solid #e5e7eb; font-size:9.5px; color:#9ca3af; }
  </style></head><body><div class="doc">
    <div class="head">
      <div class="brand">gx · PR Summary</div>
      <div class="title">${esc(d.title)}</div>
      <div class="meta">${d.ref.owner}/${d.ref.repo} · <a href="${d.url}">#${d.ref.number}</a> · ${d.changedFiles} files · +${d.additions}/-${d.deletions}</div>
    </div>
    ${summaryBlocksToHtml(summary)}
    <div class="foot">Generated by gx from public pull request #${d.ref.number}. Nothing was posted to ${d.ref.owner}/${d.ref.repo}.</div>
  </div></body></html>`;
}

function resolveChrome(): string | null {
  const envp = process.env.CHROME_PATH?.trim();
  if (envp && existsSync(envp)) return envp;
  const macApps = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const c of macApps) if (existsSync(c)) return c;
  for (const c of ["google-chrome", "chromium", "chromium-browser"]) {
    const p = Bun.spawnSync(["which", c]);
    if (p.exitCode === 0) return p.stdout.toString().trim();
  }
  return null;
}

/** Chrome writes the PDF fast but headless often won't exit — poll for the file
 * to finish writing, then kill it. Success = a non-empty PDF was produced. */
async function renderPdf(htmlPath: string, pdfPath: string): Promise<boolean> {
  const chrome = resolveChrome();
  if (!chrome) return false;
  try { if (existsSync(pdfPath)) unlinkSync(pdfPath); } catch {}
  const profile = mkdtempSync(join(tmpdir(), "gx-chrome-"));
  const proc = Bun.spawn([
    chrome, "--headless=old", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
    `--user-data-dir=${profile}`, `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ], { stdout: "ignore", stderr: "ignore" });
  const deadline = Date.now() + 25_000;
  let last = -1, stable = 0;
  try {
    while (Date.now() < deadline) {
      await Bun.sleep(250);
      if (existsSync(pdfPath)) {
        const size = statSync(pdfPath).size;
        if (size > 0 && size === last) { if (++stable >= 2) break; } else stable = 0;
        last = size;
      }
      if (proc.exitCode !== null) break;
    }
  } finally {
    try { proc.kill(); } catch {}
  }
  return existsSync(pdfPath) && statSync(pdfPath).size > 0;
}

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------

function outDir(ref: PrRef): string {
  const root = new URL("../", import.meta.url).pathname; // repo root
  return `${root}outreach-out/${ref.owner}__${ref.repo}__pr${ref.number}`;
}

async function writeOutputs(d: Dossier, summary: string): Promise<{ dir: string; pdf: boolean }> {
  const dir = outDir(d.ref);
  await Bun.write(`${dir}/summary.md`, summary + "\n");
  const htmlPath = `${dir}/summary.html`;
  await Bun.write(htmlPath, summaryToDocHtml(d, summary));
  const pdf = await renderPdf(htmlPath, `${dir}/summary.pdf`);
  return { dir, pdf };
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function cmdGen(targets: string[]): Promise<void> {
  await loadEnv();
  const { provider, note } = resolveProvider();
  console.log(`Provider: ${note}`);
  const root = new URL("../", import.meta.url).pathname;

  for (const target of targets) {
    let ref: PrRef;
    try { ref = parsePrRef(target); } catch (e) { console.error(`  skip ${target}: ${(e as Error).message}`); continue; }
    const label = `${ref.owner}/${ref.repo}#${ref.number}`;
    try {
      console.log(`\n=== ${label} ===`);
      const d = fetchDossier(ref);
      console.log(`  ${d.changedFiles} files, +${d.additions}/-${d.deletions}`);
      if (!provider) {
        await Bun.write(`${outDir(ref)}/prompt.txt`, `SYSTEM:\n${PR_SUMMARY_SYSTEM_PROMPT}\n\n====\n\nUSER:\n${buildSummaryUserPrompt(d)}`);
        console.log("  no LLM key — wrote prompt.txt only");
        continue;
      }
      const summary = await generateSummary(provider, d);
      const { dir, pdf } = await writeOutputs(d, summary);
      console.log(`  -> ${dir.replace(root, "")}  (summary.md${pdf ? " + summary.pdf" : "; PDF skipped — no Chrome"})`);
    } catch (e) {
      console.error(`  ERROR ${label}: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone. Outputs in outreach-out/`);
}

type RepoRow = { name: string; description: string | null; pushedAt: string; stargazerCount: number; isFork: boolean; primaryLanguage: { name: string } | null };

function topRepos(org: string, n: number): RepoRow[] {
  const repos = JSON.parse(gh(["repo", "list", org, "--no-archived", "--limit", "100",
    "--json", "name,description,pushedAt,stargazerCount,isFork,primaryLanguage"])) as RepoRow[];
  return repos.filter((r) => !r.isFork && r.primaryLanguage)
    .sort((a, b) => (b.pushedAt > a.pushedAt ? 1 : -1) || b.stargazerCount - a.stargazerCount).slice(0, n);
}

/** Find the product repo(s), meatiest reviewable PRs, and a live competitor bot. */
async function cmdScout(org: string): Promise<void> {
  const repos = topRepos(org, 4);
  if (repos.length === 0) { console.log(`${org}: no non-fork product repo found (thin/private footprint).`); return; }
  console.log(`\n################ ${org} ################`);
  type Cand = { repo: string; pr: number; url: string; size: number; bot: CompetitorReview | null };
  const shortlist: Cand[] = [];
  for (const r of repos) {
    const repo = `${org}/${r.name}`;
    let prs: Array<{ number: number; title: string; additions: number; deletions: number; changedFiles: number; url: string; state: string }>;
    try {
      prs = JSON.parse(gh(["pr", "list", "--repo", repo, "--state", "all", "--limit", "25",
        "--json", "number,title,additions,deletions,changedFiles,url,state"]));
    } catch { continue; }
    const isGenerated = (p: { changedFiles: number; additions: number }) => p.changedFiles > 60 || p.additions > 5000;
    const substantial = prs.filter((p) => p.changedFiles >= 3 && p.additions + p.deletions >= 40)
      .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
    const real = substantial.filter((p) => !isGenerated(p));
    const pool = real.length ? real : substantial;
    if (pool.length === 0) continue;
    const checked = pool.slice(0, 6).map((p) => ({ p, bot: detectCompetitor(fetchComments(repo, p.number)) }));
    const anyBot = checked.find((c) => c.bot)?.bot ?? null;
    const genNote = substantial.length - real.length > 0 ? ` (${substantial.length - real.length} look generated)` : "";
    console.log(`\n  ${repo}  (${r.primaryLanguage?.name}, ★${r.stargazerCount}, pushed ${r.pushedAt.slice(0, 10)})`);
    console.log(`    ${real.length} reviewable PRs${genNote}; bot on a candidate PR: ${anyBot ? `${anyBot.name}${anyBot.verdict ? ` (${anyBot.verdict})` : ""}` : "none"}`);
    for (const c of checked.slice(0, 4)) {
      console.log(`      #${c.p.number} ${c.p.state.padEnd(6)} ${c.p.changedFiles}f +${c.p.additions}/-${c.p.deletions}  ${c.bot ? `[${c.bot.name}] ` : ""}${c.p.title.slice(0, 55)}`);
    }
    for (const c of checked) shortlist.push({ repo, pr: c.p.number, url: c.p.url, size: c.p.additions + c.p.deletions, bot: c.bot });
  }
  const best = shortlist.sort((a, b) => (Number(!!b.bot) - Number(!!a.bot)) || (b.size - a.size))[0];
  if (best) {
    console.log(`\n  >> best demo: ${best.url}${best.bot ? `  (beats ${best.bot.name})` : ""}`);
    console.log(`  >> bun scripts/outreach.ts gen ${best.url}`);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "gen") {
    let targets = rest;
    const fileIdx = rest.indexOf("--file");
    if (fileIdx >= 0) {
      const path = rest[fileIdx + 1];
      if (!path) throw new Error("--file needs a path");
      targets = (await Bun.file(path).text()).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    }
    if (targets.length === 0) throw new Error("gen needs at least one PR URL (or --file targets.txt)");
    await cmdGen(targets);
  } else if (cmd === "scout") {
    if (rest.length === 0) throw new Error("scout needs at least one org");
    for (const org of rest) {
      try { await cmdScout(org); } catch (e) { console.error(`${org}: ${(e as Error).message}`); }
    }
  } else if (cmd === "models") {
    await cmdModels();
  } else {
    console.log([
      "gx outreach PR-summary generator",
      "",
      "  bun scripts/outreach.ts gen <pr-url> [<pr-url> ...]   # -> summary.md + summary.pdf",
      "  bun scripts/outreach.ts gen --file targets.txt",
      "  bun scripts/outreach.ts scout <org> [<org> ...]        # find repo + best PR + bot",
      "  bun scripts/outreach.ts models                         # list OpenAI models a key can use",
      "",
      "Set OPENAI_API_KEY (default model gpt-5) or ANTHROPIC_API_KEY. Override with OUTREACH_MODEL.",
      "PDF needs Chrome (auto-detected; set CHROME_PATH to override).",
    ].join("\n"));
    process.exit(cmd ? 1 : 0);
  }
}

await main();
