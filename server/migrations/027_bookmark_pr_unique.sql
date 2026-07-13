-- Deduplicate PR ownership before uniqueness.
-- Keep the newest real publisher with GX evidence; clear PR fields on losers;
-- delete webhook-only shells that collide.

WITH ranked AS (
  SELECT
    id,
    user_id,
    latest_event_id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, repo_full_name, github_pr_number
      ORDER BY
        CASE WHEN user_id <> 'github-webhook' AND latest_event_id IS NOT NULL THEN 0
             WHEN user_id <> 'github-webhook' THEN 1
             ELSE 2 END,
        updated_at_ms DESC
    ) AS rn
  FROM bookmarks
  WHERE github_pr_number IS NOT NULL
    AND org_id IS NOT NULL
),
losers AS (
  SELECT id, user_id, latest_event_id FROM ranked WHERE rn > 1
)
UPDATE bookmarks b
SET
  github_pr_number = NULL,
  github_pr_url = NULL,
  github_pr_node_id = NULL,
  github_repo_id = NULL,
  github_verified_at_ms = NULL,
  updated_at_ms = (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
FROM losers l
WHERE b.id = l.id
  AND l.user_id <> 'github-webhook';

WITH ranked AS (
  SELECT
    id,
    user_id,
    latest_event_id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, repo_full_name, github_pr_number
      ORDER BY
        CASE WHEN user_id <> 'github-webhook' AND latest_event_id IS NOT NULL THEN 0
             WHEN user_id <> 'github-webhook' THEN 1
             ELSE 2 END,
        updated_at_ms DESC
    ) AS rn
  FROM bookmarks
  WHERE github_pr_number IS NOT NULL
    AND org_id IS NOT NULL
),
losers AS (
  SELECT id FROM ranked
  WHERE rn > 1 AND user_id = 'github-webhook' AND latest_event_id IS NULL
)
DELETE FROM bookmarks b
USING losers l
WHERE b.id = l.id;

WITH ranked_nodes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY github_pr_node_id
      ORDER BY
        CASE WHEN user_id <> 'github-webhook' AND latest_event_id IS NOT NULL THEN 0
             WHEN user_id <> 'github-webhook' THEN 1
             ELSE 2 END,
        updated_at_ms DESC
    ) AS rn
  FROM bookmarks
  WHERE github_pr_node_id IS NOT NULL
)
UPDATE bookmarks b
SET
  github_pr_node_id = NULL,
  github_verified_at_ms = NULL,
  updated_at_ms = (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
FROM ranked_nodes r
WHERE b.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_org_repo_pr_unique
  ON bookmarks (org_id, repo_full_name, github_pr_number)
  WHERE github_pr_number IS NOT NULL AND org_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_github_pr_node_unique
  ON bookmarks (github_pr_node_id)
  WHERE github_pr_node_id IS NOT NULL;
