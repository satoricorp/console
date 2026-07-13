import { getSql } from "../db";
import { getInstallationTokenForRepo } from "../github/app";

/** Fields required to refresh bookmark merge_status from GitHub. */
export type BookmarkMergeFields = {
  id: string;
  repo_full_name: string;
  branch_name: string;
  merge_status: string;
  github_pr_url: string | null;
  github_pr_number: number | null;
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
 * Open bookmarks with no resolvable PR number: attach a branch PR if one
 * exists, otherwise mark closed so they leave the Open filter.
 */
export async function syncBookmarkWithoutPullRequest<
  T extends BookmarkMergeFields,
>(
  db: ReturnType<typeof getSql>,
  bookmark: T,
  existingToken?: string | null,
): Promise<T> {
  if (bookmark.merge_status === "merged" || bookmark.merge_status === "closed") {
    return bookmark;
  }

  if (isNonPrBranch(bookmark.branch_name)) {
    return markBookmarkClosed(db, bookmark);
  }

  const token = await resolveInstallToken(
    db,
    bookmark.repo_full_name,
    existingToken,
    bookmark.id,
  );

  try {
    const pull = await lookupPullRequestForBranch(
      bookmark.repo_full_name,
      bookmark.branch_name,
      token,
    );
    if (!pull) {
      return markBookmarkClosed(db, bookmark);
    }
    return await applyGithubPullToBookmark(db, bookmark, pull);
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
  if (bookmark.merge_status === "merged" || bookmark.merge_status === "closed") {
    return bookmark;
  }

  const prNumber = resolveGithubPrNumber(bookmark);
  if (prNumber == null) {
    return syncBookmarkWithoutPullRequest(db, bookmark, existingToken);
  }

  // undefined = look up install token; null = unauthenticated (public repos).
  const token = await resolveInstallToken(
    db,
    bookmark.repo_full_name,
    existingToken,
    bookmark.id,
  );

  try {
    const response = await fetch(
      `https://api.github.com/repos/${bookmark.repo_full_name}/pulls/${prNumber}`,
      { headers: githubHeaders(token) },
    );
    // Missing PR (deleted / never existed) — treat as closed so it leaves Open.
    if (response.status === 404) {
      return markBookmarkClosed(db, bookmark, { github_pr_number: prNumber });
    }
    if (!response.ok) {
      console.warn("merge status sync: GitHub PR lookup failed", {
        bookmarkId: bookmark.id,
        status: response.status,
      });
      return bookmark;
    }

    const pull = (await response.json()) as GithubPullSummary & {
      html_url?: string;
    };
    return await applyGithubPullToBookmark(db, bookmark, {
      number: prNumber,
      html_url: pull.html_url ?? bookmark.github_pr_url ?? "",
      merged: pull.merged,
      merged_at: pull.merged_at,
      state: pull.state,
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
 * set get a per-PR lookup. Bookmarks with no PR ref are resolved by branch
 * (or closed when no PR exists). Call before list filters so merged/closed
 * reviews leave merge_status=open.
 */
export async function reconcileOpenBookmarkMergeStatuses(
  db: ReturnType<typeof getSql>,
  auth: { userId: string; orgId: string },
): Promise<void> {
  const candidates = await db<BookmarkMergeFields[]>`
    SELECT
      id,
      repo_full_name,
      branch_name,
      merge_status,
      github_pr_url,
      github_pr_number,
      updated_at_ms
    FROM bookmarks
    WHERE (org_id = ${auth.orgId} OR user_id = ${auth.userId})
      AND merge_status = 'open'
  `;

  if (candidates.length === 0) return;

  const byRepo = groupBookmarksByRepo(candidates);
  await mapPool([...byRepo.entries()], 4, async ([repoFullName, bookmarks]) => {
    await reconcileRepoOpenBookmarks(db, repoFullName, bookmarks);
  });
}
