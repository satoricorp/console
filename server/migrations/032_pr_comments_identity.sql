-- Per-user attribution for PR comments.
--
-- user_id: the commenter's Convex user id, resolved via org_members
-- (github_user_id -> convex_user_id, 024) at ingest time. Nullable — GitHub
-- users outside the org have no mapping, and gx's own rows have none.
-- model: the LLM used for rows gx itself authored (@gx chat replies). NULL for
-- human comments.

ALTER TABLE pr_comments
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT;

CREATE INDEX IF NOT EXISTS pr_comments_org_user
  ON pr_comments (org_id, user_id, created_at_ms DESC)
  WHERE user_id IS NOT NULL;
