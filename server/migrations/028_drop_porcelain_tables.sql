-- Drop the porcelain-era tables orphaned by the plain-Git pivot. All of these
-- were verified to have no readers or writers in the codebase:
--   change_reviews             per-jj-change approval tracking (jj is gone)
--   pr_event_payloads          unused BYTEA sidecar for pr_events
--   conflict_*                 rebase/stack conflict checks (stacks are gone)
--   issues                     porcelain-era issue tracking, never wired up
DROP TABLE IF EXISTS conflict_check_diagnostics;
DROP TABLE IF EXISTS conflict_files;
DROP TABLE IF EXISTS conflict_checks;
DROP TABLE IF EXISTS change_reviews;
DROP TABLE IF EXISTS pr_event_payloads;
DROP TABLE IF EXISTS issues;
