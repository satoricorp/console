CREATE TABLE IF NOT EXISTS reported_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  user_id           TEXT NOT NULL,
  gx_version        TEXT,
  os                TEXT,
  arch              TEXT,
  repo_root         TEXT,
  repo_full_name    TEXT,
  cloud_url         TEXT,
  error             TEXT,
  status_error      TEXT,
  log_count         INTEGER NOT NULL DEFAULT 0,
  logs              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at_ms     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS reported_logs_org_created
  ON reported_logs (org_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS reported_logs_org_repo_created
  ON reported_logs (org_id, repo_full_name, created_at_ms DESC);
