ALTER TABLE gx_pr_events
  ADD COLUMN IF NOT EXISTS semantic_index_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS semantic_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_index_error TEXT,
  ADD COLUMN IF NOT EXISTS semantic_indexed_at_ms BIGINT;

ALTER TABLE gx_bookmarks
  ADD COLUMN IF NOT EXISTS semantic_index_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS semantic_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_index_error TEXT,
  ADD COLUMN IF NOT EXISTS semantic_indexed_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS gx_bookmarks_semantic_status
  ON gx_bookmarks (user_id, semantic_index_status, updated_at_ms DESC);
