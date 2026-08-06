ALTER TABLE pr_events
  ADD COLUMN IF NOT EXISTS semantic_index_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS semantic_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_index_error TEXT,
  ADD COLUMN IF NOT EXISTS semantic_indexed_at_ms BIGINT;

ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS semantic_index_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS semantic_chunks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_index_error TEXT,
  ADD COLUMN IF NOT EXISTS semantic_indexed_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS bookmarks_semantic_status
  ON bookmarks (user_id, semantic_index_status, updated_at_ms DESC);
