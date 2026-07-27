-- Record the publish bundle schema version so we can observe which CLI wire
-- shapes are still in the wild during the v1 (stack/change) → v2 (revisions)
-- transition. NULL means the bundle predates this column; the intake writes 1
-- when the CLI omitted the field.
ALTER TABLE pr_events ADD COLUMN IF NOT EXISTS schema_version INTEGER;
