CREATE TABLE IF NOT EXISTS gx_change_reviews (
  user_id TEXT NOT NULL,
  bookmark_id UUID NOT NULL REFERENCES gx_bookmarks(id) ON DELETE CASCADE,
  jj_change_id TEXT NOT NULL,
  stack_index INTEGER NOT NULL,
  approval_percent INTEGER NOT NULL CHECK (approval_percent >= 0 AND approval_percent <= 100),
  notes TEXT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, bookmark_id, jj_change_id)
);

CREATE INDEX IF NOT EXISTS gx_change_reviews_bookmark
  ON gx_change_reviews (user_id, bookmark_id, stack_index);
