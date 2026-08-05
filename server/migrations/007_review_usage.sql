CREATE TABLE IF NOT EXISTS review_usage (
  user_id       TEXT NOT NULL,
  bookmark_id   UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  first_event_id UUID REFERENCES pr_events(id) ON DELETE SET NULL,
  counted_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, bookmark_id)
);

CREATE INDEX IF NOT EXISTS review_usage_user_counted
  ON review_usage (user_id, counted_at_ms DESC);
