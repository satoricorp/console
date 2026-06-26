CREATE TABLE IF NOT EXISTS code_review_history_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  user_id           TEXT NOT NULL,
  repo_root_path    TEXT,
  repo_full_name    TEXT NOT NULL,
  branch_name       TEXT,
  head_commit_id    TEXT,
  source_kind       TEXT NOT NULL DEFAULT 'session_intent',
  source_ref        TEXT,
  prompt            TEXT,
  scope             TEXT,
  mode              TEXT,
  reviewer          TEXT,
  finding_count     INTEGER NOT NULL DEFAULT 0,
  created_at_ms     BIGINT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS code_review_history_runs_org_repo_created
  ON code_review_history_runs (org_id, repo_full_name, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS code_review_history_runs_org_repo_branch_created
  ON code_review_history_runs (org_id, repo_full_name, branch_name, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS code_review_history_runs_org_repo_head
  ON code_review_history_runs (org_id, repo_full_name, head_commit_id);

CREATE TABLE IF NOT EXISTS code_review_history_findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  run_id            UUID NOT NULL REFERENCES code_review_history_runs(id) ON DELETE CASCADE,
  repo_full_name    TEXT NOT NULL,
  fingerprint       TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('valid', 'false_positive', 'already_fixed', 'suppressed')),
  category          TEXT NOT NULL,
  language          TEXT NOT NULL DEFAULT '',
  file_path         TEXT NOT NULL DEFAULT '',
  line_start        INTEGER,
  line_end          INTEGER,
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL,
  recommendation    TEXT,
  confidence        INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 10),
  severity          TEXT,
  created_at_ms     BIGINT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS code_review_history_findings_org_fingerprint_created
  ON code_review_history_findings (org_id, fingerprint, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS code_review_history_findings_org_repo_category_created
  ON code_review_history_findings (org_id, repo_full_name, category, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS code_review_history_findings_org_repo_file_category
  ON code_review_history_findings (org_id, repo_full_name, file_path, category);

CREATE TABLE IF NOT EXISTS code_review_history_summaries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  run_id            UUID NOT NULL REFERENCES code_review_history_runs(id) ON DELETE CASCADE,
  repo_full_name    TEXT NOT NULL,
  branch_name       TEXT,
  head_commit_id    TEXT,
  summary_kind      TEXT NOT NULL DEFAULT 'pr',
  summary_text      TEXT NOT NULL,
  summary_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  model             TEXT NOT NULL DEFAULT 'deterministic',
  created_at_ms     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS code_review_history_summaries_org_repo_branch_created
  ON code_review_history_summaries (org_id, repo_full_name, branch_name, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS code_review_history_summaries_org_run
  ON code_review_history_summaries (org_id, run_id);
