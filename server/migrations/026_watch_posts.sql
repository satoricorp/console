-- OSS "watch" rail dedup / idempotency ledger.
--
-- One row per (repo, PR) that the free rail has commented on. The poller reads
-- this every tick to decide: post a new comment (no row), edit the existing
-- comment (row exists, head SHA changed), or skip (row exists, same head SHA).
-- Lives in Postgres (not Convex) because it is written on the hot path next to
-- the posting logic; the operator-managed watchlist stays in Convex.
CREATE TABLE IF NOT EXISTS watch_posts (
  id             BIGSERIAL PRIMARY KEY,
  repo_full_name TEXT   NOT NULL,
  pr_number      INTEGER NOT NULL,
  head_sha       TEXT   NOT NULL,
  -- GitHub issue-comment id of the summary we posted as the bot user; we PATCH
  -- this on later pushes instead of posting a fresh comment.
  comment_id     BIGINT,
  campaign       TEXT,
  posted_at_ms   BIGINT NOT NULL,
  updated_at_ms  BIGINT NOT NULL,
  UNIQUE (repo_full_name, pr_number)
);

CREATE INDEX IF NOT EXISTS watch_posts_repo ON watch_posts (repo_full_name);
