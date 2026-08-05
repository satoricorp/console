ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS github_mergeable BOOLEAN,
  ADD COLUMN IF NOT EXISTS github_mergeable_state TEXT,
  ADD COLUMN IF NOT EXISTS github_pr_state TEXT,
  ADD COLUMN IF NOT EXISTS ci_state TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS ci_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS github_status_checked_at_ms BIGINT,
  ADD COLUMN IF NOT EXISTS conflict_check_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS conflict_check_error TEXT;
