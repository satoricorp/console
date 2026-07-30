import { Hono, type Context } from "hono";
import { reconcileOpenBookmarkMergeStatuses } from "../bookmarks/merge-status";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { capture, Events } from "../telemetry/posthog";

export const reviewListRoutes = new Hono<AppEnv>();

// Canonical: /v1/reviews. Legacy: /bookmarks — "bookmark" was jj's word for a
// branch, and the row is really one review per pull request. The legacy paths
// forward to the same handlers (no redirect: released CLIs call /bookmarks
// directly and a 3xx would change their auth/retry behavior). They are marked
// deprecated in the response headers and counted in telemetry by CLI version so
// removal can be gated on observed traffic rather than on a calendar.
const LEGACY_SUNSET_NOTE = 'https://docs.gx.run/docs/changelog; use /v1/reviews';

reviewListRoutes.use("/v1/reviews", requireAuth);
reviewListRoutes.use("/bookmarks", requireAuth);
reviewListRoutes.use("/bookmarks/*", requireAuth);

function markDeprecated(c: Context<AppEnv>, canonicalPath: string) {
  c.header("Deprecation", "true");
  c.header("Link", `<${canonicalPath}>; rel="successor-version"`);
  c.header("Warning", `299 - "Deprecated endpoint: ${LEGACY_SUNSET_NOTE}"`);

  const auth = c.get("auth");
  capture(
    Events.DeprecatedRouteUsed,
    {
      route: c.req.path,
      canonical: canonicalPath,
      // The tx CLI sends "tx/<version>"; this is how we tell whether any
      // installed binary still depends on the legacy path.
      user_agent: c.req.header("user-agent") ?? null,
      user_id: auth?.userId ?? null,
    },
    auth?.orgId,
  );
}

type BookmarkListRow = {
  id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  head_commit_id: string | null;
  remote_head_sha: string | null;
  merge_status: string;
  updated_at_ms: number | string;
  github_pr_url: string | null;
  github_pr_number: number | null;
  latest_event_id: string | null;
  app_file_count: number | string | null;
  archived_at_ms: number | string | null;
  plan_status: string | null;
  plan_error: string | null;
};

function mapBookmarkRow(row: BookmarkListRow) {
  return {
    id: row.id,
    repo_full_name: row.repo_full_name,
    branch_name: row.branch_name,
    title: row.title,
    revision: Number(row.revision),
    head_commit_id: row.head_commit_id,
    remote_head_sha: row.remote_head_sha,
    merge_status: row.merge_status,
    updated_at_ms: Number(row.updated_at_ms),
    github_pr_url: row.github_pr_url,
    github_pr_number:
      row.github_pr_number === null || row.github_pr_number === undefined
        ? null
        : Number(row.github_pr_number),
    latest_event_id: row.latest_event_id,
    file_count: Number(row.app_file_count) || 0,
    archived_at_ms:
      row.archived_at_ms === null || row.archived_at_ms === undefined
        ? null
        : Number(row.archived_at_ms),
    plan_status: row.plan_status,
    plan_error: row.plan_error,
  };
}

async function listReviews(c: Context<AppEnv>) {
  const auth = c.get("auth");
  const mergeStatus = c.req.query("merge_status")?.trim();
  const repoFullName = c.req.query("repo_full_name")?.trim();
  const includeArchived = c.req.query("include_archived") === "1";
  const archivedOnly = mergeStatus === "archived";
  const githubPrOnly = c.req.query("github_pr_only") === "1";

  if (
    mergeStatus &&
    mergeStatus !== "open" &&
    mergeStatus !== "merged" &&
    mergeStatus !== "closed" &&
    mergeStatus !== "archived"
  ) {
    return c.json({ error: "Invalid merge_status" }, 400);
  }

  const db = getSql();
  // Backfill stale open merge_status before filtering so merged PRs that
  // missed webhooks / never opened detail still match merge_status=merged.
  await reconcileOpenBookmarkMergeStatuses(db, auth);

  // Publishes for GitHub-App-installed repos are filed under the installation
  // org (resolvePublishOrgId), not the caller's org, so an org-only filter
  // hides the user's own publishes. Match the access model of
  // loadAccessibleBookmark in routes/reviews.ts: own bookmarks always show.
  //
  // merge_status=archived is soft-archive (archived_at_ms), not GitHub state.
  // open|merged|closed exclude archived unless include_archived=1.
  const rows = await db<BookmarkListRow[]>`
    SELECT
      b.id,
      b.repo_full_name,
      b.branch_name,
      b.title,
      b.revision,
      b.head_commit_id,
      b.remote_head_sha,
      b.merge_status,
      b.updated_at_ms,
      b.github_pr_url,
      b.github_pr_number,
      b.latest_event_id,
      b.app_file_count,
      b.archived_at_ms,
      rp.status AS plan_status,
      rp.error AS plan_error
    FROM bookmarks b
    LEFT JOIN LATERAL (
      SELECT status, error
      FROM review_plans
      WHERE bookmark_id = b.id
      ORDER BY updated_at_ms DESC
      LIMIT 1
    ) rp ON true
    WHERE (b.org_id = ${auth.orgId} OR b.user_id = ${auth.userId})
      ${
        archivedOnly
          ? db`AND b.archived_at_ms IS NOT NULL`
          : mergeStatus
            ? db`AND b.merge_status = ${mergeStatus}`
            : db``
      }
      ${repoFullName ? db`AND b.repo_full_name = ${repoFullName}` : db``}
      ${githubPrOnly ? db`AND b.github_pr_number IS NOT NULL` : db``}
      ${
        archivedOnly || includeArchived
          ? db``
          : db`AND b.archived_at_ms IS NULL`
      }
    ORDER BY b.updated_at_ms DESC
  `;

  return c.json(rows.map(mapBookmarkRow));
}

async function archiveReview(c: Context<AppEnv>) {
  const auth = c.get("auth");
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Review id is required" }, 400);
  }
  const db = getSql();
  const now = Date.now();

  const [row] = await db<BookmarkListRow[]>`
    UPDATE bookmarks b
    SET archived_at_ms = ${now},
        updated_at_ms = ${now}
    WHERE b.id = ${id}::uuid
      AND (b.org_id = ${auth.orgId} OR b.user_id = ${auth.userId})
    RETURNING
      b.id,
      b.repo_full_name,
      b.branch_name,
      b.title,
      b.revision,
      b.head_commit_id,
      b.remote_head_sha,
      b.merge_status,
      b.updated_at_ms,
      b.github_pr_url,
      b.github_pr_number,
      b.latest_event_id,
      b.app_file_count,
      b.archived_at_ms,
      NULL::text AS plan_status,
      NULL::text AS plan_error
  `;

  if (!row) {
    return c.json({ error: "Review not found" }, 404);
  }

  return c.json(mapBookmarkRow(row));
}

async function unarchiveReview(c: Context<AppEnv>) {
  const auth = c.get("auth");
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Review id is required" }, 400);
  }
  const db = getSql();
  const now = Date.now();

  const [row] = await db<BookmarkListRow[]>`
    UPDATE bookmarks b
    SET archived_at_ms = NULL,
        updated_at_ms = ${now}
    WHERE b.id = ${id}::uuid
      AND (b.org_id = ${auth.orgId} OR b.user_id = ${auth.userId})
    RETURNING
      b.id,
      b.repo_full_name,
      b.branch_name,
      b.title,
      b.revision,
      b.head_commit_id,
      b.remote_head_sha,
      b.merge_status,
      b.updated_at_ms,
      b.github_pr_url,
      b.github_pr_number,
      b.latest_event_id,
      b.app_file_count,
      b.archived_at_ms,
      NULL::text AS plan_status,
      NULL::text AS plan_error
  `;

  if (!row) {
    return c.json({ error: "Review not found" }, 404);
  }

  return c.json(mapBookmarkRow(row));
}

// Canonical routes.
reviewListRoutes.get("/v1/reviews", listReviews);
reviewListRoutes.post("/v1/reviews/:id/archive", archiveReview);
reviewListRoutes.post("/v1/reviews/:id/unarchive", unarchiveReview);

// Legacy aliases — same handlers, deprecation headers, counted in telemetry.
reviewListRoutes.get("/bookmarks", (c) => {
  markDeprecated(c, "/v1/reviews");
  return listReviews(c);
});
reviewListRoutes.post("/bookmarks/:id/archive", (c) => {
  markDeprecated(c, "/v1/reviews/:id/archive");
  return archiveReview(c);
});
reviewListRoutes.post("/bookmarks/:id/unarchive", (c) => {
  markDeprecated(c, "/v1/reviews/:id/unarchive");
  return unarchiveReview(c);
});
