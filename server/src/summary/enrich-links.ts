import {
  blobPermalink,
  formatPRSummaryLink,
  githubPullFileDiffUrl,
  githubPullFileLineUrl,
  normalizePullUrl,
  parsePullNumberFromUrl,
  pullRequestNumberUrl,
} from "../github/line-links";

/**
 * Whether a `PR #N` reference may be turned into a link.
 *
 * Only the PR being summarized has a number this server can vouch for. Prior-PR
 * context rows are indexed with a branch and a head SHA and no PR number at
 * all, so any other N in a summary came from the model, not from a source.
 *
 * Linking one anyway is how satoricorp/tx#112 came to cite "PR #1" and "PR #2":
 * the context snippets are labelled [P1] and [P2], the prompt asked for
 * attributions of the form `PR #N`, and this enricher resolved the result to
 * github.com/satoricorp/gx/pull/1 and /pull/2 — two real, unrelated pull
 * requests that were never in the context. Leaving an unvouched reference as
 * plain text keeps a bad citation from masquerading as a verified one.
 */
function canLinkPullNumber(ctx: SummaryLinkContext, number: number): boolean {
  const current = parsePullNumberFromUrl(ctx.prUrl);
  return current !== null && current === number;
}

/**
 * Whether an `owner/repo#N` reference points at the pull request being
 * summarised.
 *
 * Comparing the number alone was enough to resolve `otherorg/otherrepo#57` to
 * *this* repository's pull request 57 — a real, unrelated page. Pull request
 * numbers are per-repository, so the repository has to match too.
 */
function canLinkOwnerRepoPull(
  ctx: SummaryLinkContext,
  ownerRepo: string,
  number: number,
): boolean {
  if (!canLinkPullNumber(ctx, number)) return false;
  const target = ownerRepo.trim().toLowerCase();
  if (!target) return false;
  const own = ownRepoFullName(ctx);
  return own !== null && own === target;
}

/** The `owner/repo` this summary belongs to, from the PR URL or the context. */
function ownRepoFullName(ctx: SummaryLinkContext): string | null {
  const fromCtx = ctx.repoFullName?.trim().toLowerCase();
  if (fromCtx) return fromCtx;
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i.exec(ctx.prUrl ?? "");
  return match ? match[1]!.toLowerCase() : null;
}

export type SummaryLinkHunk = {
  file: string;
  lineStart: number;
  lineEnd?: number;
};

export type SummaryLinkContext = {
  prUrl: string | null;
  headSha: string | null;
  /**
   * The `owner/repo` this summary belongs to. Optional because it is derivable
   * from prUrl; supplied it removes the guesswork when a caller already knows.
   */
  repoFullName?: string | null;
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

/** Kinds that should resolve to a concrete file:line when left bare. */
const FILE_BACKED_KINDS = new Set([
  "codebase",
  "heuristic",
  "agent-sessions",
  "docs",
]);

const FILE_EXT_RE =
  /\.(go|md|json|ya?ml|tsx?|jsx?|py|rs|toml|sql|sh|css|html|txt)$/i;
const FILE_LINE_RE = /^(.+?):(\d+)$/;
/** `path:line`, `path:N`, `path:<line>` — a placeholder the model copied, not a location. */
const PLACEHOLDER_LINE_RE = /^(.+?):<?[A-Za-z_][\w-]*>?$/;
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
  let lastBulletText: string | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.replace(/^#+\s*/, "").toLowerCase();
    if (heading === "notable changes") {
      inNotable = true;
      lastBulletText = null;
      out.push(line);
      continue;
    }
    if (inNotable && /^#{1,3}\s+\S/.test(trimmed)) {
      inNotable = false;
      lastBulletText = null;
    }
    if (inNotable && /^\s*Attribution:/i.test(line)) {
      out.push(enrichAttributionLine(line, ctx, lastBulletText));
      continue;
    }
    if (inNotable && /^-\s+/.test(trimmed)) {
      const bulletMatch = /^(-\s+)(⚠\s+)?(.+)$/.exec(line);
      lastBulletText = bulletMatch
        ? stripHtmlAnchors(bulletMatch[3]!.trim())
        : null;
      if (!trimmed.includes("<a ")) {
        out.push(enrichNotableBullet(line, ctx));
        continue;
      }
      out.push(line);
      continue;
    }
    out.push(line);
  }

  return ensureNewTabAnchors(out.join("\n"));
}

/** Ensure every summary `<a>` opens in a new tab (GitHub LOC hashes need it). */
export function ensureNewTabAnchors(html: string): string {
  return html.replace(/<a\s+([^>]*?)>/gi, (full, attrs: string) => {
    if (/\btarget\s*=/i.test(attrs) && /\brel\s*=/i.test(attrs)) {
      return full;
    }
    let next = attrs.trim();
    if (!/\btarget\s*=/i.test(next)) {
      next += ` target="_blank"`;
    }
    if (!/\brel\s*=/i.test(next)) {
      next += ` rel="noopener noreferrer"`;
    }
    return `<a ${next}>`;
  });
}

function stripHtmlAnchors(text: string): string {
  return text
    .replace(/<a\s+[^>]*>/gi, "")
    .replace(/<\/a>/gi, "")
    .trim();
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

function enrichAttributionLine(
  line: string,
  ctx: SummaryLinkContext,
  bulletText: string | null,
): string {
  const match = /^(\s*Attribution:\s*)(.+)$/i.exec(line);
  if (!match) return line;
  const prefix = match[1]!;
  const rest = match[2]!.trim();
  if (!rest) return line;
  if (rest.includes("<a ")) {
    return `${prefix}${ensureNewTabAnchors(rest)}`;
  }

  const parts = rest.split(/\s*;\s*/).map((p) => p.trim()).filter(Boolean);
  const rendered = parts.map((part) =>
    renderAttributionPart(part, ctx, bulletText),
  );
  return `${prefix}${rendered.join("; ")}`;
}

function renderAttributionPart(
  part: string,
  ctx: SummaryLinkContext,
  bulletText: string | null,
): string {
  const tokens = part.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return part;

  const kind = tokens[0]!;
  if (ATTRIBUTION_KINDS.has(kind) && tokens.length === 1) {
    const concrete = resolveBareKindConcreteRef(kind, ctx, bulletText);
    if (concrete) {
      return `${kind} ${formatPRSummaryLink(concrete.display, concrete.url)}`;
    }
    const labelUrl = ctx.labelUrls?.[kind];
    return labelUrl ? formatPRSummaryLink(kind, labelUrl) : kind;
  }

  if (ATTRIBUTION_KINDS.has(kind) && tokens.length > 1) {
    const remainder = tokens.slice(1).join(" ");
    const linked = linkifyAttributionText(remainder, ctx);
    // If the model left a vague note (no file/PR link), still attach a concrete ref.
    if (
      FILE_BACKED_KINDS.has(kind) &&
      linked === remainder &&
      !looksLikeFilePath(remainder.split(/\s+/)[0] ?? "")
    ) {
      const concrete = resolveBareKindConcreteRef(kind, ctx, bulletText);
      if (concrete) {
        return `${kind} ${formatPRSummaryLink(concrete.display, concrete.url)}; ${linked}`;
      }
    }
    return `${kind} ${linked}`;
  }

  return linkifyAttributionText(part, ctx);
}

function resolveBareKindConcreteRef(
  kind: string,
  ctx: SummaryLinkContext,
  bulletText: string | null,
): { display: string; url: string } | null {
  if (kind === "previous-prs") {
    const fromBullet = bulletText ? extractPrRef(bulletText) : null;
    if (fromBullet) {
      const url = resolvePRRefURL(fromBullet, ctx);
      if (url) return { display: fromBullet, url };
    }
    return null;
  }

  if (!FILE_BACKED_KINDS.has(kind)) return null;

  const fromBullet = bulletText ? findBestFileRef(bulletText, ctx) : null;
  const ref = fromBullet ?? firstHunkRef(ctx);
  if (!ref) return null;

  const line =
    ref.line > 0
      ? ref.line
      : (ctx.hunks.find((h) => h.file === ref.file && h.lineStart > 0)
          ?.lineStart ?? 0);
  const display = line > 0 ? `${ref.file}:${line}` : ref.file;
  const url = resolveFileRefURL(ctx, ref.file, line);
  if (!url) return null;
  return { display, url };
}

function firstHunkRef(
  ctx: SummaryLinkContext,
): { file: string; line: number } | null {
  const hunk = ctx.hunks.find((h) => h.file.trim());
  if (hunk) {
    return { file: hunk.file.trim(), line: hunk.lineStart > 0 ? hunk.lineStart : 0 };
  }
  const file = (ctx.changedFiles ?? []).find((f) => f.trim());
  return file ? { file: file.trim(), line: 0 } : null;
}

function extractPrRef(text: string): string | null {
  const ownerRepo = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)/.exec(text);
  if (ownerRepo) return `${ownerRepo[1]}#${ownerRepo[2]}`;
  const prNum = /\bPR\s*#(\d+)\b/i.exec(text);
  if (prNum) return `PR #${prNum[1]}`;
  const hash = /(?:^|[^\w/])#(\d+)\b/.exec(text);
  if (hash) return `PR #${hash[1]}`;
  return null;
}

function linkifyAttributionText(text: string, ctx: SummaryLinkContext): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const wholeUrl = resolveRefURL(trimmed, ctx);
  if (wholeUrl) {
    return formatPRSummaryLink(displayRef(trimmed), wholeUrl);
  }

  const labelUrl = ctx.labelUrls?.[trimmed];
  if (labelUrl) {
    return formatPRSummaryLink(trimmed, labelUrl);
  }

  let result = trimmed;
  result = replaceAllMatches(result, PR_OWNER_REPO_NUM_RE, (match, g1, g2) => {
    if (!canLinkOwnerRepoPull(ctx, g1 ?? "", Number(g2))) return match;
    const [owner, repo] = (g1 ?? "").split("/");
    const url = pullRequestNumberUrl(ctx.prUrl, Number(g2), owner, repo);
    return url ? formatPRSummaryLink(match, url) : match;
  });
  result = replaceAllMatches(result, PR_NUMBER_RE, (match, g1) => {
    if (!canLinkPullNumber(ctx, Number(g1))) return match;
    const url = pullRequestNumberUrl(ctx.prUrl, Number(g1));
    return url ? formatPRSummaryLink(match, url) : match;
  });
  // Only link bare #N when the whole remaining text is that ref (avoid issue noise).
  if (/^#\d+$/.test(result) && canLinkPullNumber(ctx, Number(result.slice(1)))) {
    const url = pullRequestNumberUrl(ctx.prUrl, Number(result.slice(1)));
    if (url) return formatPRSummaryLink(result, url);
  }

  result = linkifyFilePathTokens(result, ctx);
  return result;
}

function linkifyFilePathTokens(text: string, ctx: SummaryLinkContext): string {
  if (!text || text.includes("<a ")) return text;
  PATH_TOKEN_RE.lastIndex = 0;
  return text.replace(PATH_TOKEN_RE, (full, pathToken: string) => {
    const { file, line } = parseFileLineRef(pathToken);
    if (!looksLikeFilePath(file)) return full;
    const url = resolveFileRefURL(ctx, file, line);
    if (!url) return full;
    const prefix = full.slice(0, full.length - pathToken.length);
    return `${prefix}${formatPRSummaryLink(pathToken, url)}`;
  });
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
    const target = `${ownerRepo[1]}/${ownerRepo[2]}`;
    if (!canLinkOwnerRepoPull(ctx, target, Number(ownerRepo[3]))) return "";
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
    if (!canLinkPullNumber(ctx, Number(prNum[1]))) return "";
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

/**
 * The text to show for a reference. A `path:line` placeholder the model copied
 * verbatim is shown as the bare path, so the label matches where the link goes.
 */
function displayRef(ref: string): string {
  const trimmed = ref.trim();
  if (FILE_LINE_RE.test(trimmed)) return trimmed;
  const placeholder = PLACEHOLDER_LINE_RE.exec(trimmed);
  return placeholder && looksLikeFilePath(placeholder[1]!)
    ? placeholder[1]!
    : trimmed;
}

export function parseFileLineRef(ref: string): { file: string; line: number } {
  const trimmed = ref.trim();
  if (!trimmed) return { file: "", line: 0 };
  const match = FILE_LINE_RE.exec(trimmed);
  if (!match) {
    // The prompt writes `path:line` to describe the shape of a reference, and
    // models sometimes copy that literally. A non-numeric suffix is not a line
    // number, and leaving it attached produced links to `broker.ts:line` — a
    // path that does not exist — on every summary. Drop the suffix instead.
    const placeholder = PLACEHOLDER_LINE_RE.exec(trimmed);
    if (placeholder) return { file: placeholder[1]!, line: 0 };
    return { file: trimmed, line: 0 };
  }
  const line = Number(match[2]);
  if (!Number.isFinite(line) || line <= 0) {
    return { file: match[1]!, line: 0 };
  }
  return { file: match[1]!, line };
}

export function looksLikeFilePath(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // Free-text notes may contain a path token; the whole string is not a path.
  if (/\s/.test(v)) return false;
  // `owner/repo#12` has a slash but is a pull request reference, not a path.
  // Without this, a cross-repository reference that the PR linker correctly
  // refused fell through to here and became a blob URL under this repository —
  // github.com/<us>/blob/<sha>/otherorg/otherrepo#57 — which is a worse lie
  // than the wrong pull request, because it looks like a file we own.
  if (/#\d+$/.test(v)) return false;
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
