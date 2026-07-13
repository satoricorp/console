-- Read-only audit for Strict GX↔GitHub PR reviews.
-- Run via scripts/rds.sh production "$(cat server/scripts/audit-review-eligibility.sql)"

SELECT 'totals' AS bucket, COUNT(*)::text AS n FROM bookmarks
UNION ALL
SELECT 'webhook_only', COUNT(*)::text
FROM bookmarks
WHERE user_id = 'github-webhook'
UNION ALL
SELECT 'gx_no_pr', COUNT(*)::text
FROM bookmarks
WHERE user_id <> 'github-webhook'
  AND latest_event_id IS NOT NULL
  AND github_pr_number IS NULL
UNION ALL
SELECT 'gx_with_pr', COUNT(*)::text
FROM bookmarks
WHERE user_id <> 'github-webhook'
  AND latest_event_id IS NOT NULL
  AND github_pr_number IS NOT NULL
UNION ALL
SELECT 'eligible_open', COUNT(*)::text
FROM bookmarks b
WHERE b.user_id <> 'github-webhook'
  AND b.latest_event_id IS NOT NULL
  AND b.github_pr_number IS NOT NULL
  AND b.github_unavailable_at_ms IS NULL
  AND b.merge_status = 'open'
  AND b.archived_at_ms IS NULL
  AND EXISTS (
    SELECT 1 FROM pr_events e
    WHERE e.id = b.latest_event_id AND e.user_id = b.user_id
  )
UNION ALL
SELECT 'duplicate_org_repo_pr', COUNT(*)::text FROM (
  SELECT org_id, repo_full_name, github_pr_number
  FROM bookmarks
  WHERE github_pr_number IS NOT NULL AND org_id IS NOT NULL
  GROUP BY 1, 2, 3
  HAVING COUNT(*) > 1
) d;

-- Sample problematic IDs (limit 20)
SELECT
  id,
  repo_full_name,
  branch_name,
  user_id,
  github_pr_number,
  latest_event_id IS NOT NULL AS has_event,
  merge_status,
  github_unavailable_at_ms IS NOT NULL AS unavailable
FROM bookmarks
WHERE id IN (
  '91b9830d-5ca1-4fed-aeac-e75a375cc54e'::uuid,
  '628b81ad-d132-46d1-b5b2-23eabb73a6f6'::uuid
)
OR (
  user_id = 'github-webhook'
  OR (latest_event_id IS NOT NULL AND github_pr_number IS NULL)
)
ORDER BY updated_at_ms DESC
LIMIT 20;
