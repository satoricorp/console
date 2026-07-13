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

/** Map a GitHub PR payload to the bookmark merge_status we store. */
export function mergeStatusFromGithubPull(pull: {
  merged?: boolean;
  state?: string;
}): "merged" | "closed" | "open" {
  if (pull.merged) return "merged";
  if (pull.state === "closed") return "closed";
  return "open";
}

/** When local merge_status looks stale, refresh from GitHub via the app install. */
export async function syncBookmarkMergeStatusFromGithub<
  T extends BookmarkMergeFields,
>(db: ReturnType<typeof getSql>, bookmark: T): Promise<T> {
  if (
    bookmark.merge_status === "merged" ||
    bookmark.merge_status === "closed" ||
    bookmark.github_pr_number == null
  ) {
    return bookmark;
  }

  let token: string | null = null;
  try {
    token = await getInstallationTokenForRepo(db, bookmark.repo_full_name);
  } catch (error) {
    console.warn("merge status sync: installation token failed", {
      bookmarkId: bookmark.id,
      error: error instanceof Error ? error.message : error,
    });
    return bookmark;
  }
  if (!token) return bookmark;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${bookmark.repo_full_name}/pulls/${bookmark.github_pr_number}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "gx-cloud",
        },
      },
    );
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
          github_pr_url = COALESCE(bookmarks.github_pr_url, ${pull.html_url ?? null}),
          updated_at_ms = ${now}
        WHERE id = ${bookmark.id}::uuid
      `;
      return {
        ...bookmark,
        merge_status: "merged",
        github_pr_url: bookmark.github_pr_url ?? pull.html_url ?? null,
        updated_at_ms: now,
      };
    }

    await db`
      UPDATE bookmarks SET
        merge_status = 'closed',
        github_pr_url = COALESCE(bookmarks.github_pr_url, ${pull.html_url ?? null}),
        updated_at_ms = ${now}
      WHERE id = ${bookmark.id}::uuid
    `;
    return {
      ...bookmark,
      merge_status: "closed",
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

/**
 * Refresh merge_status from GitHub for accessible bookmarks still marked open.
 * Call before list filters so merged PRs appear under merge_status=merged.
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
      AND github_pr_number IS NOT NULL
  `;

  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map((bookmark) => syncBookmarkMergeStatusFromGithub(db, bookmark)),
  );
}
