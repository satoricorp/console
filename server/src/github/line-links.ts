import { createHash } from "node:crypto";

/** HTML link matching the former TX CLI `formatPRSummaryLink` for PR bodies. */
export function formatPRSummaryLink(text: string, url: string): string {
  const label = text.trim();
  const href = url.trim();
  if (!href) return label;
  if (!label) return href;
  return `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(label)}</a>`;
}

export function githubPullFileLineUrl(
  githubPrUrl: string | null | undefined,
  file: string,
  line: number | null | undefined,
): string | null {
  const prUrl = normalizePullUrl(githubPrUrl);
  const path = file.trim();
  if (!prUrl || !path || typeof line !== "number" || line <= 0) {
    return null;
  }

  const diffId = createHash("sha256").update(path).digest("hex");
  return `${prUrl}/files#diff-${diffId}R${Math.floor(line)}`;
}

/** File-level PR diff anchor (`#diff-<sha256>`) without a line. */
export function githubPullFileDiffUrl(
  githubPrUrl: string | null | undefined,
  file: string,
): string | null {
  const prUrl = normalizePullUrl(githubPrUrl);
  const path = file.trim();
  if (!prUrl || !path) return null;
  const diffId = createHash("sha256").update(path).digest("hex");
  return `${prUrl}/files#diff-${diffId}`;
}

/** Blob permalink at a commit; optional `#L<n>` when line > 0. */
export function blobPermalink(
  githubPrUrl: string | null | undefined,
  sha: string | null | undefined,
  file: string,
  line: number | null | undefined = null,
): string | null {
  const prUrl = normalizePullUrl(githubPrUrl);
  const commit = sha?.trim() ?? "";
  const path = file.trim();
  if (!prUrl || !commit || !path) return null;
  const parsed = parseGitHubOwnerRepo(prUrl);
  if (!parsed) return null;
  let link = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${commit}/${path}`;
  if (typeof line === "number" && line > 0) {
    link += `#L${Math.floor(line)}`;
  }
  return link;
}

export function parseGitHubOwnerRepo(
  githubPrUrl: string | null | undefined,
): { owner: string; repo: string } | null {
  const prUrl = normalizePullUrl(githubPrUrl);
  if (!prUrl) return null;
  try {
    const u = new URL(prUrl);
    if (u.hostname.toLowerCase() !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0]!, repo: parts[1]! };
  } catch {
    return null;
  }
}

export function pullRequestNumberUrl(
  githubPrUrl: string | null | undefined,
  number: number,
  owner?: string,
  repo?: string,
): string | null {
  if (!Number.isFinite(number) || number <= 0) return null;
  const parsed = parseGitHubOwnerRepo(githubPrUrl);
  const o = (owner?.trim() || parsed?.owner || "").trim();
  const r = (repo?.trim() || parsed?.repo || "").trim();
  if (!o || !r) return null;
  return `https://github.com/${o}/${r}/pull/${Math.floor(number)}`;
}

export function normalizePullUrl(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) return null;
  return /\/pull\/\d+(?:$|[/?#])/.test(trimmed) ? trimmed : null;
}

/** The pull request number a PR URL points at, or null when it is not a PR URL. */
export function parsePullNumberFromUrl(
  value: string | null | undefined,
): number | null {
  const prUrl = normalizePullUrl(value);
  if (!prUrl) return null;
  const match = /\/pull\/(\d+)/.exec(prUrl);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
