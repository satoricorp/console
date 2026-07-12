-- Org membership for tenant isolation (keyed by GitHub user id).

CREATE TABLE IF NOT EXISTS org_members (
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  github_user_id  BIGINT NOT NULL,
  convex_user_id  TEXT,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin', 'member')),
  source          TEXT NOT NULL DEFAULT 'manual',
  created_at_ms   BIGINT NOT NULL,
  PRIMARY KEY (org_id, github_user_id)
);

CREATE INDEX IF NOT EXISTS org_members_github_user_id
  ON org_members (github_user_id);

CREATE INDEX IF NOT EXISTS org_members_convex_user_id
  ON org_members (convex_user_id)
  WHERE convex_user_id IS NOT NULL;
