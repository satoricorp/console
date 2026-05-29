CREATE TABLE IF NOT EXISTS gx_change_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  bookmark_id UUID NOT NULL REFERENCES gx_bookmarks(id) ON DELETE CASCADE,
  jj_change_id TEXT NOT NULL,
  stack_index INT NOT NULL,
  approval_percent INT NOT NULL CHECK (approval_percent >= 0 AND approval_percent <= 100),
  notes TEXT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  UNIQUE (user_id, bookmark_id, jj_change_id)
);

CREATE INDEX IF NOT EXISTS gx_change_reviews_bookmark_stack
  ON gx_change_reviews (bookmark_id, stack_index);

CREATE INDEX IF NOT EXISTS gx_change_reviews_user_bookmark
  ON gx_change_reviews (user_id, bookmark_id);
