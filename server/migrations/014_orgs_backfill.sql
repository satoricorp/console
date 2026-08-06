-- WP-4: add org_id to the legacy tables and backfill orgs.

-- Backfill orgs from GitHub App installations (one org per installation)
INSERT INTO orgs (installation_id, created_at_ms)
SELECT
  installation_id,
  COALESCE(installed_at_ms, updated_at_ms, (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT)
FROM github_app_installations
ON CONFLICT (installation_id) DO NOTHING;

-- Bootstrap org for single-player rows without installation mapping
INSERT INTO orgs (plan, created_at_ms)
SELECT 'free', (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
WHERE NOT EXISTS (
  SELECT 1 FROM orgs WHERE installation_id IS NULL
);

-- DEPRECATED: drop after WP-5 promotion verifies ingest reads columnar tables
COMMENT ON COLUMN pr_events.payload IS 'DEPRECATED: drop after WP-5 promotion';

-- Add org_id to legacy tables (nullable until backfill completes)
ALTER TABLE pr_events
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

ALTER TABLE change_reviews
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

ALTER TABLE review_usage
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

ALTER TABLE conflict_checks
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

-- Backfill bookmarks.org_id via repo → github_app_repositories → installation → orgs
UPDATE bookmarks b
SET org_id = o.id
FROM github_app_repositories gar
JOIN orgs o ON o.installation_id = gar.installation_id
WHERE b.repo_full_name = gar.full_name
  AND gar.access_state = 'installed'
  AND b.org_id IS NULL;

-- Backfill pr_events.org_id via bookmark latest_event_id
UPDATE pr_events e
SET org_id = b.org_id
FROM bookmarks b
WHERE b.latest_event_id = e.id
  AND b.org_id IS NOT NULL
  AND e.org_id IS NULL;

-- Backfill pr_events.org_id via matching github_pr_url
UPDATE pr_events e
SET org_id = b.org_id
FROM bookmarks b
WHERE e.github_pr_url IS NOT NULL
  AND e.github_pr_url = b.github_pr_url
  AND b.org_id IS NOT NULL
  AND e.org_id IS NULL;

-- Backfill child tables from bookmark org_id
UPDATE change_reviews cr
SET org_id = b.org_id
FROM bookmarks b
WHERE cr.bookmark_id = b.id
  AND b.org_id IS NOT NULL
  AND cr.org_id IS NULL;

UPDATE review_usage ru
SET org_id = b.org_id
FROM bookmarks b
WHERE ru.bookmark_id = b.id
  AND b.org_id IS NOT NULL
  AND ru.org_id IS NULL;

UPDATE issues i
SET org_id = b.org_id
FROM bookmarks b
WHERE i.bookmark_id = b.id
  AND b.org_id IS NOT NULL
  AND i.org_id IS NULL;

UPDATE conflict_checks cc
SET org_id = b.org_id
FROM bookmarks b
WHERE cc.bookmark_id = b.id
  AND b.org_id IS NOT NULL
  AND cc.org_id IS NULL;

-- Assign bootstrap org to any remaining unmapped rows
DO $$
DECLARE
  bootstrap_org_id UUID;
BEGIN
  SELECT id INTO bootstrap_org_id
  FROM orgs
  WHERE installation_id IS NULL
  ORDER BY created_at_ms
  LIMIT 1;

  IF bootstrap_org_id IS NULL THEN
    INSERT INTO orgs (plan, created_at_ms)
    VALUES ('free', (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT)
    RETURNING id INTO bootstrap_org_id;
  END IF;

  UPDATE bookmarks SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  UPDATE pr_events SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  UPDATE change_reviews SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  UPDATE review_usage SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  UPDATE issues SET org_id = bootstrap_org_id WHERE org_id IS NULL;
  UPDATE conflict_checks SET org_id = bootstrap_org_id WHERE org_id IS NULL;
END $$;

-- Enforce NOT NULL on org_id after backfill
ALTER TABLE bookmarks ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE change_reviews ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE review_usage ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE issues ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE conflict_checks ALTER COLUMN org_id SET NOT NULL;
-- pr_events may have orphan events; keep nullable for now (ingest backfill in WP-5)

-- Re-key review_usage for org-scoped metering (3 free PR Summaries per org)
ALTER TABLE review_usage DROP CONSTRAINT IF EXISTS review_usage_pkey;
ALTER TABLE review_usage ADD PRIMARY KEY (org_id, bookmark_id);

-- Org-scoped indexes to match the new org_id column
CREATE INDEX IF NOT EXISTS pr_events_org_created
  ON pr_events (org_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS pr_events_org_user_created
  ON pr_events (org_id, user_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS bookmarks_org_updated
  ON bookmarks (org_id, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS bookmarks_org_semantic_status
  ON bookmarks (org_id, semantic_index_status, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS change_reviews_org_bookmark
  ON change_reviews (org_id, bookmark_id, stack_index);

CREATE INDEX IF NOT EXISTS review_usage_org_counted
  ON review_usage (org_id, counted_at_ms DESC);

CREATE INDEX IF NOT EXISTS issues_org_bookmark_status
  ON issues (org_id, bookmark_id, status, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS conflict_checks_org_bookmark_updated
  ON conflict_checks (org_id, bookmark_id, updated_at_ms DESC);
