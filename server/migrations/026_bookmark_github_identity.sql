-- Canonical GitHub identity for 1:1 GX ↔ PR reviews.
ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS github_repo_id BIGINT,
  ADD COLUMN IF NOT EXISTS github_pr_node_id TEXT,
  ADD COLUMN IF NOT EXISTS github_verified_at_ms BIGINT,
  ADD COLUMN IF NOT EXISTS github_unavailable_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS bookmarks_github_pr_node_id
  ON bookmarks (github_pr_node_id)
  WHERE github_pr_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookmarks_review_eligible
  ON bookmarks (org_id, updated_at_ms DESC)
  WHERE latest_event_id IS NOT NULL
    AND github_pr_number IS NOT NULL
    AND user_id <> 'github-webhook'
    AND github_unavailable_at_ms IS NULL;
