ALTER TABLE gx_pr_events
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS machine_id TEXT;

CREATE INDEX IF NOT EXISTS gx_pr_events_user_id_created
  ON gx_pr_events (user_id, created_at_ms DESC);
