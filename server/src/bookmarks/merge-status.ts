import { getSql } from "../db";
import { getInstallationTokenForRepo } from "../github/app";

/** Fields required to refresh bookmark merge_status from GitHub. */
export type BookmarkMergeFields = {
  id: string;
  repo_full_name: string;
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
export function resolveGithubPrNumber(
  bookmark: Pick<BookmarkMergeFields, "github_pr_number" | "github_pr_url">,
): number | null {
  if (bookmark.github_pr_number != null) {
    return Number(bookmark.github_pr_number);
  }
  return parseGithubPrNumber(bookmark.github_pr_url);
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
    return bookmark;
  }

  // undefined = look up install token; null = unauthenticated (public repos).
  let token: string | null;
  if (existingToken === undefined) {
    try {
      token = await getInstallationTokenForRepo(db, bookmark.repo_full_name);
    } catch (error) {
      console.warn("merge status sync: installation token failed", {
        bookmarkId: bookmark.id,
        error: error instanceof Error ? error.message : error,
      });
      token = null;
    }
  } else {
    token = existingToken;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${bookmark.repo_full_name}/pulls/${prNumber}`,
      { headers: githubHeaders(token) },
    );
    // Missing PR (deleted / never existed) — treat as closed so it leaves Open.
    if (response.status === 404) {
      const now = Date.now();
      await db`
        UPDATE bookmarks SET
          merge_status = 'closed',
          github_pr_number = COALESCE(bookmarks.github_pr_number, ${prNumber}),
          updated_at_ms = ${now}
        WHERE id = ${bookmark.id}::uuid
      `;
      return {
        ...bookmark,
        merge_status: "closed",
        github_pr_number: bookmark.github_pr_number ?? prNumber,
        updated_at_ms: now,
      };
    }
    if (!response.ok) {
      console.warn("merge status sync: GitHub PR lookup failed", {
        bookmarkId: bookmark.id,
        status: response.status,
      });
      return bookmark;
    }

    const pull = (await response.json()) as {
      merged?: boolean;
      state?: string;
      merged_at?: string | null;
      html_url?: string;
    };

    const nextStatus = mergeStatusFromGithubPull(pull);
    if (nextStatus === "open") {
      // Backfill PR number if we only had a URL.
      if (bookmark.github_pr_number == null) {
        const now = Date.now();
        await db`
          UPDATE bookmarks SET
            github_pr_number = ${prNumber},
            github_pr_url = COALESCE(bookmarks.github_pr_url, ${pull.html_url ?? null}),
            updated_at_ms = ${now}
          WHERE id = ${bookmark.id}::uuid
        `;
        return {
          ...bookmark,
          github_pr_number: prNumber,
          github_pr_url: bookmark.github_pr_url ?? pull.html_url ?? null,
          updated_at_ms: now,
        };
      }
      return bookmark;
    }

    const now = Date.now();
    if (nextStatus === "merged") {
      const mergedAt =
        (typeof pull.merged_at === "string" ? Date.parse(pull.merged_at) : now) ||
        now;
      await db`
        UPDATE bookmarks SET
          merge_status = 'merged',
          merged_at_ms = ${mergedAt},
          github_pr_number = COALESCE(bookmarks.github_pr_number, ${prNumber}),
          github_pr_url = COALESCE(bookmarks.github_pr_url, ${pull.html_url ?? null}),
          updated_at_ms = ${now}
        WHERE id = ${bookmark.id}::uuid
      `;
      return {
        ...bookmark,
        merge_status: "merged",
        github_pr_number: bookmark.github_pr_number ?? prNumber,
        github_pr_url: bookmark.github_pr_url ?? pull.html_url ?? null,
        updated_at_ms: now,
      };
    }

    await db`
      UPDATE bookmarks SET
        merge_status = 'closed',
        github_pr_number = COALESCE(bookmarks.github_pr_number, ${prNumber}),
        github_pr_url = COALESCE(bookmarks.github_pr_url, ${pull.html_url ?? null}),
        updated_at_ms = ${now}
      WHERE id = ${bookmark.id}::uuid
    `;
    return {
      ...bookmark,
      merge_status: "closed",
      github_pr_number: bookmark.github_pr_number ?? prNumber,
      github_pr_url: bookmark.github_pr_url ?? pull.html_url ?? null,
      updated_at_ms: now,
    };
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

  let openNumbers: Set<number> | null = null;
  try {
    openNumbers = await listOpenPullNumbers(repoFullName, token);
  } catch (error) {
    console.warn("merge status reconcile: open PR list threw", {
      repoFullName,
      error: error instanceof Error ? error.message : error,
    });
  }

  const toSync =
    openNumbers == null
      ? bookmarks
      : bookmarksMissingFromOpenSet(bookmarks, openNumbers);

  if (toSync.length === 0) return;

  await mapPool(toSync, 5, async (bookmark) => {
    await syncBookmarkMergeStatusFromGithub(db, bookmark, token);
  });
}

/**
 * Refresh merge_status from GitHub for accessible bookmarks still marked open.
 * Groups by repo and lists open PRs once per repo; only PRs missing from that
 * set get a per-PR lookup. Call before list filters so merged PRs appear under
 * merge_status=merged.
 */
export async function reconcileOpenBookmarkMergeStatuses(
  db: ReturnType<typeof getSql>,
  auth: { userId: string; orgId: string },
): Promise<void> {
  const candidates = await db<BookmarkMergeFields[]>`
    SELECT
      id,
      repo_full_name,
      merge_status,
      github_pr_url,
      github_pr_number,
      updated_at_ms
    FROM bookmarks
    WHERE (org_id = ${auth.orgId} OR user_id = ${auth.userId})
      AND merge_status = 'open'
      AND (
        github_pr_number IS NOT NULL
        OR github_pr_url IS NOT NULL
      )
  `;

  if (candidates.length === 0) return;

  const byRepo = groupBookmarksByRepo(candidates);
  await mapPool([...byRepo.entries()], 4, async ([repoFullName, bookmarks]) => {
    await reconcileRepoOpenBookmarks(db, repoFullName, bookmarks);
  });
}
