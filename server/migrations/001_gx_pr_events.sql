CREATE TABLE IF NOT EXISTS gx_pr_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event             TEXT NOT NULL DEFAULT 'gx.pr',
  created_at_ms     BIGINT NOT NULL,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  gx_version        TEXT NOT NULL,

  github_user_id    BIGINT,
  github_user_login TEXT,

  repo_root_path    TEXT,
  repo_backend      TEXT,
  remote_url        TEXT,
  branch_name       TEXT,
  head_commit_id    TEXT NOT NULL,
  github_pr_url     TEXT,

  payload           JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS gx_pr_events_user_created
  ON gx_pr_events (github_user_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS gx_pr_events_remote_branch
  ON gx_pr_events (remote_url, branch_name, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS gx_pr_events_pr_url
  ON gx_pr_events (github_pr_url);

CREATE INDEX IF NOT EXISTS gx_pr_events_head
  ON gx_pr_events (head_commit_id);
