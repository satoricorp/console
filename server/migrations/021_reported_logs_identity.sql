ALTER TABLE reported_logs
  ADD COLUMN IF NOT EXISTS reported_user_id TEXT,
  ADD COLUMN IF NOT EXISTS login TEXT,
  ADD COLUMN IF NOT EXISTS machine_id TEXT;

CREATE INDEX IF NOT EXISTS reported_logs_org_machine_created
  ON reported_logs (org_id, machine_id, created_at_ms DESC);
