-- WP-4: flatten conflict_checks.conflicted_files JSONB → conflict_files child table.
-- diagnostics JSONB → conflict_check_diagnostics key/value rows (no queryable JSONB on new tables).

CREATE TABLE IF NOT EXISTS conflict_files (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id  UUID NOT NULL REFERENCES conflict_checks(id) ON DELETE CASCADE,
  file      TEXT NOT NULL,
  UNIQUE (check_id, file)
);

CREATE INDEX IF NOT EXISTS conflict_files_check_id
  ON conflict_files (check_id);

-- Migrate existing conflicted_files JSONB arrays into rows
INSERT INTO conflict_files (check_id, file)
SELECT cc.id, jsonb_array_elements_text(cc.conflicted_files)
FROM conflict_checks cc
WHERE jsonb_array_length(cc.conflicted_files) > 0
ON CONFLICT (check_id, file) DO NOTHING;

-- Flatten diagnostics JSONB overflow (base_sha/head_sha already on conflict_checks from 010)
CREATE TABLE IF NOT EXISTS conflict_check_diagnostics (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id  UUID NOT NULL REFERENCES conflict_checks(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  UNIQUE (check_id, key)
);

CREATE INDEX IF NOT EXISTS conflict_check_diagnostics_check_id
  ON conflict_check_diagnostics (check_id);

INSERT INTO conflict_check_diagnostics (check_id, key, value)
SELECT cc.id, kv.key, kv.value
FROM conflict_checks cc
CROSS JOIN LATERAL jsonb_each_text(cc.diagnostics) AS kv(key, value)
WHERE cc.diagnostics <> '{}'::jsonb
  AND kv.key NOT IN ('base_sha', 'head_sha')
ON CONFLICT (check_id, key) DO NOTHING;

-- Legacy columns retained until WP-5 reads child tables exclusively
COMMENT ON COLUMN conflict_checks.conflicted_files IS 'DEPRECATED: use conflict_files child table; drop after WP-5';
COMMENT ON COLUMN conflict_checks.diagnostics IS 'DEPRECATED: use conflict_check_diagnostics child table; drop after WP-5';
