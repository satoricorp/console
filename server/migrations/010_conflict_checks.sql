CREATE TABLE IF NOT EXISTS conflict_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'conflicted', 'clean', 'failed')),
  base_sha TEXT,
  head_sha TEXT,
  conflicted_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS conflict_checks_bookmark_updated
  ON conflict_checks (bookmark_id, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  UNIQUE (bookmark_id, source, source_key)
);

CREATE INDEX IF NOT EXISTS issues_bookmark_status
  ON issues (user_id, bookmark_id, status, updated_at_ms DESC);
