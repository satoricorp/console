import type postgres from "postgres";

/** Rows that can appear in /reviews and related review APIs. */
export type ReviewEligibleFields = {
  id: string;
  user_id: string;
  latest_event_id: string | null;
  github_pr_number: number | null;
  github_pr_node_id?: string | null;
  github_verified_at_ms?: number | string | null;
  github_unavailable_at_ms?: number | string | null;
};

export const WEBHOOK_BOOKMARK_USER = "github-webhook";

/** SQL fragment: bookmark is a real GX publisher row with push evidence + PR. */
export function reviewEligibilitySql(db: postgres.Sql) {
  return db`
    b.user_id <> ${WEBHOOK_BOOKMARK_USER}
    AND b.latest_event_id IS NOT NULL
    AND b.github_pr_number IS NOT NULL
    AND b.github_unavailable_at_ms IS NULL
    AND EXISTS (
      SELECT 1
      FROM pr_events e
      WHERE e.id = b.latest_event_id
        AND e.user_id = b.user_id
        AND e.user_id <> ${WEBHOOK_BOOKMARK_USER}
    )
  `;
}

/** In-memory eligibility for tests and post-load checks. */
export function isReviewEligibleBookmark(
  bookmark: ReviewEligibleFields & {
    event_user_id?: string | null;
  },
): boolean {
  if (bookmark.user_id === WEBHOOK_BOOKMARK_USER) return false;
  if (!bookmark.latest_event_id) return false;
  if (bookmark.github_pr_number == null) return false;
  if (
    bookmark.github_unavailable_at_ms !== null &&
    bookmark.github_unavailable_at_ms !== undefined
  ) {
    return false;
  }
  if (
    bookmark.event_user_id != null &&
    (bookmark.event_user_id === WEBHOOK_BOOKMARK_USER ||
      bookmark.event_user_id !== bookmark.user_id)
  ) {
    return false;
  }
  return true;
}
