import { getSql } from "../db";
import { getInstallationTokenForRepo } from "../github/app";
import {
  fetchVerifiedGithubPull,
  linkVerifiedPullToBookmark,
  lookupVerifiedOpenPullForBranch,
  markGithubPullUnavailable,
} from "./canonical-pr";
import { reviewEligibilitySql, WEBHOOK_BOOKMARK_USER } from "./eligibility";

/** Fields required to refresh bookmark merge_status from GitHub. */
export type BookmarkMergeFields = {
  id: string;
  org_id?: string;
  user_id?: string;
  repo_full_name: string;
  branch_name: string;
  merge_status: string;
  github_pr_url: string | null;
  github_pr_number: number | null;
  head_commit_id?: string | null;
  github_repo_id?: number | null;
  github_pr_node_id?: string | null;
  github_verified_at_ms?: number | string | null;
  github_unavailable_at_ms?: number | string | null;
  updated_at_ms: number | string;
};

const githubHeaders = (token?: string | null) => ({
  Accept: "application/vnd.github+json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "gx-cloud",
});

/** Parse a PR number from a GitHub pull request URL. */
export function parseGithubPrNumber(
  githubPrUrl: string | null | undefined,
): number | null {
  if (!githubPrUrl) return null;
  const match = /\/pull\/(\d+)(?:\/|$)/.exec(githubPrUrl);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Prefer stored PR number; fall back to parsing github_pr_url. */
export function resolveGithubPrNumber(bookmark: {
  github_pr_number: number | null;
  github_pr_url?: string | null;
}): number | null {
  if (bookmark.github_pr_number != null) {
    return Number(bookmark.github_pr_number);
  }
  return parseGithubPrNumber(bookmark.github_pr_url);
}

/**
 * Branches that never represent an open GitHub PR review target.
 * Publishes against these stay merge_status=open forever without cleanup.
 */
export function isNonPrBranch(branchName: string | null | undefined): boolean {
  const branch = (branchName ?? "").trim().toLowerCase();
  if (!branch) return true;
  return (
    branch === "main" ||
    branch === "master" ||
    branch === "head" ||
    branch === "unknown" ||
    branch === "develop" ||
    branch === "trunk"
  );
}

/** Map a GitHub PR payload to the bookmark merge_status we store. */
export function mergeStatusFromGithubPull(pull: {
  merged?: boolean;
  merged_at?: string | null;
  state?: string;
}): "merged" | "closed" | "open" {
  if (pull.merged || (typeof pull.merged_at === "string" && pull.merged_at)) {
    return "merged";
  }
  if (pull.state === "closed") return "closed";
  return "open";
}

/** Group bookmarks by repo_full_name for repo-scoped GitHub queries. */
export function groupBookmarksByRepo<T extends { repo_full_name: string }>(
  bookmarks: T[],
): Map<string, T[]> {
  const byRepo = new Map<string, T[]>();
  for (const bookmark of bookmarks) {
    const list = byRepo.get(bookmark.repo_full_name);
    if (list) {
      list.push(bookmark);
    } else {
      byRepo.set(bookmark.repo_full_name, [bookmark]);
    }
  }
  return byRepo;
}

/**
 * Bookmarks whose PR numbers are absent from GitHub's open set (stale open).
 * Numbers still open need no per-PR API call.
 */
export function bookmarksMissingFromOpenSet<
  T extends { github_pr_number: number | null; github_pr_url?: string | null },
>(bookmarks: T[], openNumbers: Set<number>): T[] {
  return bookmarks.filter((bookmark) => {
    const prNumber = resolveGithubPrNumber(bookmark);
    return prNumber != null && !openNumbers.has(prNumber);
  });
}

/** Run async work with a fixed concurrency limit. */
export async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
}

type GithubPullSummary = {
  number: number;
  html_url: string;
  merged?: boolean;
  merged_at?: string | null;
  state?: string;
};

/** Paginate GitHub open PRs for a repo; returns null on API failure. */
export async function listOpenPullNumbers(
  repoFullName: string,
  token: string | null,
): Promise<Set<number> | null> {
  const open = new Set<number>();
  let page = 1;

  for (;;) {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/pulls?state=open&per_page=100&page=${page}`,
      { headers: githubHeaders(token) },
    );
    if (!response.ok) {
      console.warn("merge status sync: open PR list failed", {
        repoFullName,
        status: response.status,
      });
      return null;
    }

    const pulls = (await response.json()) as Array<{ number?: number }>;
    for (const pull of pulls) {
      if (typeof pull.number === "number") {
        open.add(pull.number);
      }
    }
    if (pulls.length < 100) break;
    page += 1;
  }

  return open;
}

/** Look up a PR for a branch head; prefer open, then most recent closed. */
export async function lookupPullRequestForBranch(
  repoFullName: string,
  branchName: string,
  token: string | null,
): Promise<GithubPullSummary | null> {
  const branch = branchName.trim();
  if (!branch || isNonPrBranch(branch)) {
    return null;
  }

  const owner = repoFullName.split("/")[0]?.trim();
  if (!owner) return null;

  const head = `${owner}:${branch}`;

  for (const state of ["open", "closed"] as const) {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/pulls?state=${state}&head=${encodeURIComponent(head)}&per_page=1&sort=updated&direction=desc`,
      { headers: githubHeaders(token) },
    );
    if (!response.ok) {
      console.warn("merge status sync: branch PR lookup failed", {
        repoFullName,
        branchName: branch,
        state,
        status: response.status,
      });
      return null;
    }
    const payload = (await response.json()) as GithubPullSummary[];
    const first = payload[0];
    if (typeof first?.number === "number" && first.html_url) {
      return first;
    }
  }

  return null;
}

async function resolveInstallToken(
  db: ReturnType<typeof getSql>,
  repoFullName: string,
  existingToken: string | null | undefined,
  bookmarkId?: string,
): Promise<string | null> {
  if (existingToken !== undefined) {
    return existingToken;
  }
  try {
    return await getInstallationTokenForRepo(db, repoFullName);
  } catch (error) {
    console.warn("merge status sync: installation token failed", {
      bookmarkId,
      repoFullName,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

async function markBookmarkClosed<T extends BookmarkMergeFields>(
  db: ReturnType<typeof getSql>,
  bookmark: T,
  extras?: {
    github_pr_number?: number | null;
    github_pr_url?: string | null;
  },
): Promise<T> {
  const now = Date.now();
  const prNumber = extras?.github_pr_number ?? null;
  const prUrl = extras?.github_pr_url ?? null;
  await db`
    UPDATE bookmarks SET
      merge_status = 'closed',
      github_pr_number = COALESCE(bookmarks.github_pr_number, ${prNumber}),
      github_pr_url = COALESCE(bookmarks.github_pr_url, ${prUrl}),
      updated_at_ms = ${now}
    WHERE id = ${bookmark.id}::uuid
  `;
  return {
    ...bookmark,
    merge_status: "closed",
    github_pr_number: bookmark.github_pr_number ?? prNumber,
    github_pr_url: bookmark.github_pr_url ?? prUrl,
    updated_at_ms: now,
  };
}

async function applyGithubPullToBookmark<T extends BookmarkMergeFields>(
  db: ReturnType<typeof getSql>,
  bookmark: T,
  pull: GithubPullSummary,
): Promise<T> {
  const nextStatus = mergeStatusFromGithubPull(pull);
  const prNumber = pull.number;
  const prUrl = pull.html_url?.trim() ? pull.html_url : null;
  const now = Date.now();

  if (nextStatus === "open") {
    await db`
      UPDATE bookmarks SET
        github_pr_number = ${prNumber},
        github_pr_url = COALESCE(bookmarks.github_pr_url, ${prUrl}),
        updated_at_ms = ${now}
      WHERE id = ${bookmark.id}::uuid
    `;
    return {
      ...bookmark,
      github_pr_number: prNumber,
      github_pr_url: bookmark.github_pr_url ?? prUrl,
      updated_at_ms: now,
    };
  }

  if (nextStatus === "merged") {
    const mergedAt =
      (typeof pull.merged_at === "string" ? Date.parse(pull.merged_at) : now) ||
      now;
    await db`
      UPDATE bookmarks SET
        merge_status = 'merged',
        merged_at_ms = ${mergedAt},
        github_pr_number = COALESCE(bookmarks.github_pr_number, ${prNumber}),
        github_pr_url = COALESCE(bookmarks.github_pr_url, ${prUrl}),
        updated_at_ms = ${now}
      WHERE id = ${bookmark.id}::uuid
    `;
    return {
      ...bookmark,
      merge_status: "merged",
      github_pr_number: bookmark.github_pr_number ?? prNumber,
      github_pr_url: bookmark.github_pr_url ?? prUrl,
      updated_at_ms: now,
    };
  }

  return markBookmarkClosed(db, bookmark, {
    github_pr_number: prNumber,
    github_pr_url: prUrl,
  });
}

/**
 * Open GX captures with no PR yet: try to attach a verified branch PR.
 * If none exists, leave the row alone (internal/pre-PR) — never mislabel as closed.
 */
export async function syncBookmarkWithoutPullRequest<
  T extends BookmarkMergeFields,
>(
  db: ReturnType<typeof getSql>,
  bookmark: T,
  _existingToken?: string | null,
): Promise<T> {
  if (bookmark.merge_status === "merged" || bookmark.merge_status === "closed") {
    return bookmark;
  }

  if (isNonPrBranch(bookmark.branch_name)) {
    return bookmark;
  }

  if (!bookmark.org_id) {
    return bookmark;
  }

  try {
    const pull = await lookupVerifiedOpenPullForBranch(
      db,
      bookmark.repo_full_name,
      bookmark.branch_name,
      bookmark.head_commit_id ?? null,
    );
    if (!pull) {
      return bookmark;
    }
    const linked = await linkVerifiedPullToBookmark(db, {
      orgId: bookmark.org_id,
      bookmarkId: bookmark.id,
      pull,
    });
    if (!linked) return bookmark;
    return {
      ...bookmark,
      ...linked,
    };
  } catch (error) {
    console.warn("merge status branch sync failed", {
      bookmarkId: bookmark.id,
      error: error instanceof Error ? error.message : error,
    });
    return bookmark;
  }
}

/** When local merge_status looks stale, refresh from GitHub via the app install. */
export async function syncBookmarkMergeStatusFromGithub<
  T extends BookmarkMergeFields,
>(
  db: ReturnType<typeof getSql>,
  bookmark: T,
  existingToken?: string | null,
): Promise<T> {
  // Merged is terminal. Closed PRs are still reconciled (GitHub can reopen).
  if (bookmark.merge_status === "merged") {
    return bookmark;
  }
  if (
    bookmark.github_unavailable_at_ms !== null &&
    bookmark.github_unavailable_at_ms !== undefined
  ) {
    return bookmark;
  }

  const prNumber = resolveGithubPrNumber(bookmark);
  if (prNumber == null) {
    return syncBookmarkWithoutPullRequest(db, bookmark, existingToken);
  }

  try {
    const verified = await fetchVerifiedGithubPull(
      db,
      bookmark.repo_full_name,
      prNumber,
    );
    if (verified === "not_found") {
      await markGithubPullUnavailable(db, bookmark.id);
      return {
        ...bookmark,
        merge_status:
          bookmark.merge_status === "merged" ? "merged" : "closed",
        github_unavailable_at_ms: Date.now(),
      };
    }
    if (verified === "error") {
      // Preserve last known state on auth/rate-limit/5xx.
      return bookmark;
    }

    if (bookmark.org_id && bookmark.user_id !== WEBHOOK_BOOKMARK_USER) {
      const linked = await linkVerifiedPullToBookmark(db, {
        orgId: bookmark.org_id,
        bookmarkId: bookmark.id,
        pull: verified,
      });
      if (linked) {
        return {
          ...bookmark,
          ...linked,
        };
      }
    }

    return await applyGithubPullToBookmark(db, bookmark, {
      number: verified.number,
      html_url: verified.htmlUrl,
      merged: verified.merged,
      merged_at: verified.mergedAt,
      state: verified.state,
    });
  } catch (error) {
    console.warn("merge status sync failed", {
      bookmarkId: bookmark.id,
      error: error instanceof Error ? error.message : error,
    });
  }

  return bookmark;
}

async function reconcileRepoOpenBookmarks(
  db: ReturnType<typeof getSql>,
  repoFullName: string,
  bookmarks: BookmarkMergeFields[],
): Promise<void> {
  let token: string | null = null;
  try {
    token = await getInstallationTokenForRepo(db, repoFullName);
  } catch (error) {
    console.warn("merge status reconcile: installation token failed", {
      repoFullName,
      error: error instanceof Error ? error.message : error,
    });
    token = null;
  }

  const withPr: BookmarkMergeFields[] = [];
  const withoutPr: BookmarkMergeFields[] = [];
  for (const bookmark of bookmarks) {
    if (resolveGithubPrNumber(bookmark) != null) {
      withPr.push(bookmark);
    } else {
      withoutPr.push(bookmark);
    }
  }

  let openNumbers: Set<number> | null = null;
  if (withPr.length > 0) {
    try {
      openNumbers = await listOpenPullNumbers(repoFullName, token);
    } catch (error) {
      console.warn("merge status reconcile: open PR list threw", {
        repoFullName,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  const staleWithPr =
    openNumbers == null ? withPr : bookmarksMissingFromOpenSet(withPr, openNumbers);

  const toSync = [...staleWithPr, ...withoutPr];
  if (toSync.length === 0) return;

  await mapPool(toSync, 5, async (bookmark) => {
    await syncBookmarkMergeStatusFromGithub(db, bookmark, token);
  });
}

/**
 * Refresh merge_status from GitHub for accessible bookmarks still marked open.
 * Groups by repo and lists open PRs once per repo; only PRs missing from that
 * set get a per-PR lookup. Pre-PR GX captures attempt attach only (never closed).
 * Kept for raw /bookmarks sync; Reviews UI uses reconcileReviewBookmarkMergeStatuses.
 */
export async function reconcileOpenBookmarkMergeStatuses(
  db: ReturnType<typeof getSql>,
  auth: { userId: string; orgId: string },
): Promise<void> {
  const candidates = await db<BookmarkMergeFields[]>`
    SELECT
      id,
      org_id,
      user_id,
      repo_full_name,
      branch_name,
      merge_status,
      github_pr_url,
      github_pr_number,
      head_commit_id,
      github_repo_id,
      github_pr_node_id,
      github_verified_at_ms,
      github_unavailable_at_ms,
      updated_at_ms
    FROM bookmarks
    WHERE (org_id = ${auth.orgId} OR user_id = ${auth.userId})
      AND merge_status = 'open'
      AND user_id <> ${WEBHOOK_BOOKMARK_USER}
  `;

  if (candidates.length === 0) return;

  const byRepo = groupBookmarksByRepo(candidates);
  await mapPool([...byRepo.entries()], 4, async ([repoFullName, bookmarks]) => {
    await reconcileRepoOpenBookmarks(db, repoFullName, bookmarks);
  });
}

/**
 * Reconcile eligible / near-eligible review bookmarks (non-merged) for /v1/reviews.
 * Includes closed PRs so reopen is detected; skips merged and unavailable.
 */
export async function reconcileReviewBookmarkMergeStatuses(
  db: ReturnType<typeof getSql>,
  auth: { userId: string; orgId: string },
): Promise<void> {
  const candidates = await db<BookmarkMergeFields[]>`
    SELECT
      b.id,
      b.org_id,
      b.user_id,
      b.repo_full_name,
      b.branch_name,
      b.merge_status,
      b.github_pr_url,
      b.github_pr_number,
      b.head_commit_id,
      b.github_repo_id,
      b.github_pr_node_id,
      b.github_verified_at_ms,
      b.github_unavailable_at_ms,
      b.updated_at_ms
    FROM bookmarks b
    WHERE (b.org_id = ${auth.orgId} OR b.user_id = ${auth.userId})
      AND b.merge_status <> 'merged'
      AND b.github_unavailable_at_ms IS NULL
      AND (
        (${reviewEligibilitySql(db)})
        OR (
          b.user_id <> ${WEBHOOK_BOOKMARK_USER}
          AND b.latest_event_id IS NOT NULL
          AND b.github_pr_number IS NULL
        )
      )
  `;

  if (candidates.length === 0) return;

  const byRepo = groupBookmarksByRepo(candidates);
  await mapPool([...byRepo.entries()], 4, async ([repoFullName, bookmarks]) => {
    await reconcileRepoOpenBookmarks(db, repoFullName, bookmarks);
  });
}
