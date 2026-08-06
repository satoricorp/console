CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  title TEXT,
  revision INT NOT NULL DEFAULT 1,
  latest_event_id UUID REFERENCES pr_events(id) ON DELETE SET NULL,
  head_commit_id TEXT,
  github_pr_url TEXT,
  github_pr_number INT,
  remote_head_sha TEXT,
  merge_status TEXT NOT NULL DEFAULT 'open' CHECK (merge_status IN ('open', 'merged', 'closed')),
  merged_at_ms BIGINT,
  published_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'github',
  UNIQUE (user_id, repo_full_name, branch_name)
);

CREATE INDEX IF NOT EXISTS bookmarks_user_updated
  ON bookmarks (user_id, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS bookmarks_latest_event
  ON bookmarks (latest_event_id);
