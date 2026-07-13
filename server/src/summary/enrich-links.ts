import {
  blobPermalink,
  formatPRSummaryLink,
  githubPullFileDiffUrl,
  githubPullFileLineUrl,
  normalizePullUrl,
  pullRequestNumberUrl,
} from "../github/line-links";

export type SummaryLinkHunk = {
  file: string;
  lineStart: number;
  lineEnd?: number;
};

export type SummaryLinkContext = {
  prUrl: string | null;
  headSha: string | null;
  hunks: SummaryLinkHunk[];
  /** Extra changed files (e.g. from published revisions) not in hunks. */
  changedFiles?: string[];
  /** Optional opaque label → URL (docs, indexed resources). */
  labelUrls?: Record<string, string>;
};

const ATTRIBUTION_KINDS = new Set([
  "agent-sessions",
  "codebase",
  "previous-prs",
  "docs",
  "heuristic",
]);

const FILE_EXT_RE =
  /\.(go|md|json|ya?ml|tsx?|jsx?|py|rs|toml|sql|sh|css|html|txt)$/i;
const FILE_LINE_RE = /^(.+?):(\d+)$/;
const PR_OWNER_REPO_NUM_RE =
  /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/gi;
const PR_NUMBER_RE = /\bPR\s*#(\d+)\b/gi;
const PATH_TOKEN_RE =
  /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+(?:\.\w+)?(?::\d+)?)(?=$|[\s`"'),.;])/g;

/**
 * Post-process a rich PR summary: link Notable Changes titles to PR diff/hunk
 * anchors and linkify Attribution source paths / PR refs when resolvable.
 * Idempotent for already-linked HTML.
 */
export function enrichSummaryLinks(
  summary: string,
  ctx: SummaryLinkContext,
): string {
  const lines = summary.split("\n");
  let inNotable = false;
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.replace(/^#+\s*/, "").toLowerCase();
    if (heading === "notable changes") {
      inNotable = true;
      out.push(line);
      continue;
    }
    if (inNotable && /^#{1,3}\s+\S/.test(trimmed)) {
      inNotable = false;
    }
    if (inNotable && /^\s*Attribution:/i.test(line)) {
      out.push(enrichAttributionLine(line, ctx));
      continue;
    }
    if (inNotable && /^-\s+/.test(trimmed) && !trimmed.includes("<a ")) {
      out.push(enrichNotableBullet(line, ctx));
      continue;
    }
    out.push(line);
  }

  return out.join("\n");
}

function enrichNotableBullet(line: string, ctx: SummaryLinkContext): string {
  const match = /^(-\s+)(⚠\s+)?(.+)$/.exec(line);
  if (!match) return line;
  const prefix = match[1]!;
  const flagged = match[2] ?? "";
  const title = match[3]!.trim();
  if (!title || title.includes("<a ")) return line;

  const ref = findBestFileRef(title, ctx);
  const url = ref ? resolveFileRefURL(ctx, ref.file, ref.line) : "";
  if (!url) return line;
  return `${prefix}${flagged}${formatPRSummaryLink(title, url)}`;
}

function enrichAttributionLine(line: string, ctx: SummaryLinkContext): string {
  const match = /^(\s*Attribution:\s*)(.+)$/i.exec(line);
  if (!match) return line;
  const prefix = match[1]!;
  const rest = match[2]!.trim();
  if (!rest || rest.includes("<a ")) return line;

  const parts = rest.split(/\s*;\s*/).map((p) => p.trim()).filter(Boolean);
  const rendered = parts.map((part) => renderAttributionPart(part, ctx));
  return `${prefix}${rendered.join("; ")}`;
}

function renderAttributionPart(part: string, ctx: SummaryLinkContext): string {
  const tokens = part.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return part;

  const kind = tokens[0]!;
  if (ATTRIBUTION_KINDS.has(kind) && tokens.length === 1) {
    const labelUrl = ctx.labelUrls?.[kind];
    return labelUrl ? formatPRSummaryLink(kind, labelUrl) : kind;
  }

  if (ATTRIBUTION_KINDS.has(kind) && tokens.length > 1) {
    const remainder = tokens.slice(1).join(" ");
    const linked = linkifyAttributionText(remainder, ctx);
    return `${kind} ${linked}`;
  }

  return linkifyAttributionText(part, ctx);
}

function linkifyAttributionText(text: string, ctx: SummaryLinkContext): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const wholeUrl = resolveRefURL(trimmed, ctx);
  if (wholeUrl) {
    return formatPRSummaryLink(trimmed, wholeUrl);
  }

  const labelUrl = ctx.labelUrls?.[trimmed];
  if (labelUrl) {
    return formatPRSummaryLink(trimmed, labelUrl);
  }

  let result = trimmed;
  result = replaceAllMatches(result, PR_OWNER_REPO_NUM_RE, (match, g1, g2) => {
    const [owner, repo] = (g1 ?? "").split("/");
    const url = pullRequestNumberUrl(ctx.prUrl, Number(g2), owner, repo);
    return url ? formatPRSummaryLink(match, url) : match;
  });
  result = replaceAllMatches(result, PR_NUMBER_RE, (match, g1) => {
    const url = pullRequestNumberUrl(ctx.prUrl, Number(g1));
    return url ? formatPRSummaryLink(match, url) : match;
  });
  // Only link bare #N when the whole remaining text is that ref (avoid issue noise).
  if (/^#\d+$/.test(result)) {
    const url = pullRequestNumberUrl(ctx.prUrl, Number(result.slice(1)));
    if (url) return formatPRSummaryLink(result, url);
  }

  return result;
}

function resolveRefURL(ref: string, ctx: SummaryLinkContext): string {
  const trimmed = ref.trim();
  if (!trimmed) return "";

  const prUrl = resolvePRRefURL(trimmed, ctx);
  if (prUrl) return prUrl;

  const labelUrl = ctx.labelUrls?.[trimmed];
  if (labelUrl) return labelUrl;

  const { file, line } = parseFileLineRef(trimmed);
  if (!looksLikeFilePath(file)) return "";
  return resolveFileRefURL(ctx, file, line);
}

function resolvePRRefURL(ref: string, ctx: SummaryLinkContext): string {
  const ownerRepo = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(ref);
  if (ownerRepo) {
    return (
      pullRequestNumberUrl(
        ctx.prUrl,
        Number(ownerRepo[3]),
        ownerRepo[1],
        ownerRepo[2],
      ) ?? ""
    );
  }
  const prNum = /^(?:PR\s*)?#(\d+)$/i.exec(ref);
  if (prNum) {
    return pullRequestNumberUrl(ctx.prUrl, Number(prNum[1])) ?? "";
  }
  return "";
}

export function resolveFileRefURL(
  ctx: SummaryLinkContext,
  file: string,
  line: number,
): string {
  const path = file.trim();
  if (!path) return "";
  const prUrl = normalizePullUrl(ctx.prUrl);

  if (fileInDiff(ctx, path)) {
    if (line > 0 && lineInHunk(ctx.hunks, path, line)) {
      return githubPullFileLineUrl(prUrl, path, line) ?? "";
    }
    const hunk = ctx.hunks.find((h) => h.file === path);
    if (hunk && hunk.lineStart > 0) {
      return githubPullFileLineUrl(prUrl, path, hunk.lineStart) ?? "";
    }
    return githubPullFileDiffUrl(prUrl, path) ?? "";
  }

  return blobPermalink(prUrl, ctx.headSha, path, line > 0 ? line : null) ?? "";
}

function fileInDiff(ctx: SummaryLinkContext, file: string): boolean {
  if (ctx.hunks.some((h) => h.file === file)) return true;
  return (ctx.changedFiles ?? []).includes(file);
}

function lineInHunk(
  hunks: SummaryLinkHunk[],
  file: string,
  line: number,
): boolean {
  for (const hunk of hunks) {
    if (hunk.file !== file) continue;
    const end = hunk.lineEnd && hunk.lineEnd >= hunk.lineStart
      ? hunk.lineEnd
      : hunk.lineStart;
    if (line >= hunk.lineStart && line <= end) return true;
  }
  return false;
}

function findBestFileRef(
  text: string,
  ctx: SummaryLinkContext,
): { file: string; line: number } | null {
  const known = uniqueFiles(ctx);
  // Prefer longest known path that appears in the text.
  const sorted = [...known].sort((a, b) => b.length - a.length);
  for (const file of sorted) {
    const idx = text.indexOf(file);
    if (idx < 0) continue;
    const after = text.slice(idx + file.length);
    const lineMatch = /^:(\d+)\b/.exec(after);
    const line = lineMatch ? Number(lineMatch[1]) : 0;
    return { file, line };
  }

  // Fall back to path-like tokens (may resolve via blob permalink).
  PATH_TOKEN_RE.lastIndex = 0;
  let best: { file: string; line: number; len: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_RE.exec(text)) !== null) {
    const token = m[1]!;
    const { file, line } = parseFileLineRef(token);
    if (!looksLikeFilePath(file)) continue;
    if (!best || file.length > best.len) {
      best = { file, line, len: file.length };
    }
  }
  return best ? { file: best.file, line: best.line } : null;
}

function uniqueFiles(ctx: SummaryLinkContext): string[] {
  const set = new Set<string>();
  for (const h of ctx.hunks) {
    if (h.file.trim()) set.add(h.file.trim());
  }
  for (const f of ctx.changedFiles ?? []) {
    if (f.trim()) set.add(f.trim());
  }
  return [...set];
}

export function parseFileLineRef(ref: string): { file: string; line: number } {
  const trimmed = ref.trim();
  if (!trimmed) return { file: "", line: 0 };
  const match = FILE_LINE_RE.exec(trimmed);
  if (!match) return { file: trimmed, line: 0 };
  const line = Number(match[2]);
  if (!Number.isFinite(line) || line <= 0) {
    return { file: match[1]!, line: 0 };
  }
  return { file: match[1]!, line };
}

export function looksLikeFilePath(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("/")) return true;
  return FILE_EXT_RE.test(v);
}

function replaceAllMatches(
  text: string,
  re: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  // Clone with global flag to avoid lastIndex surprises across calls.
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return text.replace(global, (match, ...args) => {
    const groups = args.slice(0, -2) as string[];
    return replacer(match, ...groups);
  });
}
