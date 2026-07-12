-- Soft-archive for /reviews list filtering (independent of merge_status).
ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS archived_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS bookmarks_user_archived
  ON bookmarks (user_id, archived_at_ms)
  WHERE archived_at_ms IS NOT NULL;
