-- WP-4: flatten bookmarks.ci_details JSONB → bookmark_ci_checks child table.

CREATE TABLE IF NOT EXISTS bookmark_ci_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id),
  bookmark_id     UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  check_name      TEXT NOT NULL,
  status          TEXT NOT NULL,
  url             TEXT,
  updated_at_ms   BIGINT NOT NULL,
  UNIQUE (bookmark_id, check_name)
);

CREATE INDEX IF NOT EXISTS bookmark_ci_checks_org_id
  ON bookmark_ci_checks (org_id);

CREATE INDEX IF NOT EXISTS bookmark_ci_checks_bookmark
  ON bookmark_ci_checks (bookmark_id, updated_at_ms DESC);

-- Migrate ci_details when shaped as { "checks": [ { "name", "status", "url" } ] }
INSERT INTO bookmark_ci_checks (org_id, bookmark_id, check_name, status, url, updated_at_ms)
SELECT
  b.org_id,
  b.id,
  COALESCE(elem->>'name', elem->>'check_name', elem->>'context', 'unknown'),
  COALESCE(elem->>'status', elem->>'conclusion', elem->>'state', 'unknown'),
  COALESCE(elem->>'url', elem->>'details_url', elem->>'html_url'),
  COALESCE(
    (elem->>'updated_at_ms')::BIGINT,
    b.github_status_checked_at_ms,
    b.updated_at_ms,
    (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
  )
FROM bookmarks b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(b.ci_details->'checks') = 'array' THEN b.ci_details->'checks'
    WHEN jsonb_typeof(b.ci_details->'check_runs') = 'array' THEN b.ci_details->'check_runs'
    WHEN jsonb_typeof(b.ci_details) = 'array' THEN b.ci_details
    ELSE '[]'::jsonb
  END
) AS elem
WHERE b.ci_details IS NOT NULL
  AND b.ci_details <> '{}'::jsonb
  AND b.org_id IS NOT NULL
ON CONFLICT (bookmark_id, check_name) DO NOTHING;

-- Migrate top-level key/value pairs when ci_details is a flat object map
INSERT INTO bookmark_ci_checks (org_id, bookmark_id, check_name, status, url, updated_at_ms)
SELECT
  b.org_id,
  b.id,
  kv.key,
  COALESCE(kv.value->>'status', kv.value->>'conclusion', kv.value->>'state', 'unknown'),
  COALESCE(kv.value->>'url', kv.value->>'details_url'),
  COALESCE(
    (kv.value->>'updated_at_ms')::BIGINT,
    b.github_status_checked_at_ms,
    b.updated_at_ms,
    (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
  )
FROM bookmarks b
CROSS JOIN LATERAL jsonb_each(b.ci_details) AS kv(key, value)
WHERE b.ci_details IS NOT NULL
  AND b.ci_details <> '{}'::jsonb
  AND jsonb_typeof(b.ci_details) = 'object'
  AND NOT (b.ci_details ? 'checks')
  AND NOT (b.ci_details ? 'check_runs')
  AND jsonb_typeof(kv.value) = 'object'
  AND b.org_id IS NOT NULL
ON CONFLICT (bookmark_id, check_name) DO NOTHING;

COMMENT ON COLUMN bookmarks.ci_details IS 'DEPRECATED: use bookmark_ci_checks child table; drop after WP-5';
