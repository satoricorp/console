-- Log when a PR summary/body post was triggered but skipped (e.g. trial expired).

CREATE TABLE IF NOT EXISTS github_post_skips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id),
  bookmark_id     UUID REFERENCES bookmarks(id) ON DELETE SET NULL,
  event_id        UUID,
  reason          TEXT NOT NULL,
  source          TEXT NOT NULL,
  pr_number       INT,
  repo_full_name  TEXT,
  created_at_ms   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS github_post_skips_org_created
  ON github_post_skips (org_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS github_post_skips_bookmark
  ON github_post_skips (bookmark_id, created_at_ms DESC)
  WHERE bookmark_id IS NOT NULL;
