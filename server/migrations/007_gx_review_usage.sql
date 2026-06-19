CREATE TABLE IF NOT EXISTS gx_review_usage (
  user_id       TEXT NOT NULL,
  bookmark_id   UUID NOT NULL REFERENCES gx_bookmarks(id) ON DELETE CASCADE,
  first_event_id UUID REFERENCES gx_pr_events(id) ON DELETE SET NULL,
  counted_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, bookmark_id)
);

CREATE INDEX IF NOT EXISTS gx_review_usage_user_counted
  ON gx_review_usage (user_id, counted_at_ms DESC);
