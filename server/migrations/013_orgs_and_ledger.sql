-- WP-4: orgs + new org-keyed ledger tables (no queryable JSONB on new tables).
-- FKs reference bookmarks / pr_events; 014 renames preserve FK constraints.

CREATE TABLE IF NOT EXISTS orgs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id   BIGINT UNIQUE REFERENCES github_app_installations(installation_id),
  plan              TEXT NOT NULL DEFAULT 'free',
  hosted_vault      TEXT,
  created_at_ms     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS orgs_installation_id
  ON orgs (installation_id);

-- GitHub review/issue comments
CREATE TABLE IF NOT EXISTS pr_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  bookmark_id         UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  github_comment_id   BIGINT,
  author              TEXT,
  body                TEXT NOT NULL,
  file                TEXT,
  line                INTEGER,
  in_reply_to         BIGINT,
  is_gx_mention       BOOLEAN NOT NULL DEFAULT false,
  created_at_ms       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS pr_comments_org_id
  ON pr_comments (org_id);

CREATE INDEX IF NOT EXISTS pr_comments_org_bookmark
  ON pr_comments (org_id, bookmark_id, created_at_ms DESC);

-- Review decisions derived from comments
CREATE TABLE IF NOT EXISTS decisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  bookmark_id         UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  reviewer            TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('approve', 'request_changes', 'comment')),
  source_comment_id   UUID REFERENCES pr_comments(id) ON DELETE SET NULL,
  extracted_reason    TEXT,
  created_at_ms       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS decisions_org_id
  ON decisions (org_id);

CREATE INDEX IF NOT EXISTS decisions_org_bookmark
  ON decisions (org_id, bookmark_id, created_at_ms DESC);

-- Inferred/enforced coding rules
CREATE TABLE IF NOT EXISTS rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  repo_scope          TEXT,
  rule_text           TEXT NOT NULL,
  scope_expr          TEXT,
  strength            TEXT NOT NULL CHECK (strength IN ('binding', 'preference')),
  status              TEXT NOT NULL CHECK (status IN ('inferred', 'enforced', 'retired')),
  source_comment_id   UUID REFERENCES pr_comments(id) ON DELETE SET NULL,
  hit_count           INTEGER NOT NULL DEFAULT 0,
  revert_correlation  REAL,
  created_at_ms       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS rules_org_id
  ON rules (org_id);

CREATE INDEX IF NOT EXISTS rules_org_status
  ON rules (org_id, status, created_at_ms DESC);

-- Post-merge outcomes (revert, hotfix, incident, clean)
CREATE TABLE IF NOT EXISTS outcomes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  bookmark_id         UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('revert', 'hotfix', 'incident', 'clean')),
  evidence_sha        TEXT,
  evidence_pr         INTEGER,
  evidence_url        TEXT,
  evidence_note       TEXT,
  detected_at_ms      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS outcomes_org_id
  ON outcomes (org_id);

CREATE INDEX IF NOT EXISTS outcomes_org_bookmark
  ON outcomes (org_id, bookmark_id, detected_at_ms DESC);

-- WP-1 hunk matcher output; event_id → pr_events (pr_events until 014 rename)
CREATE TABLE IF NOT EXISTS hunk_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  event_id            UUID NOT NULL REFERENCES pr_events(id) ON DELETE CASCADE,
  file                TEXT NOT NULL,
  line_start          INTEGER NOT NULL,
  line_end            INTEGER NOT NULL,
  session_id          TEXT NOT NULL,
  match_tier          INTEGER NOT NULL,
  confidence          REAL NOT NULL,
  authorship          TEXT NOT NULL CHECK (authorship IN ('agent', 'human', 'unknown')),
  tool                TEXT,
  model               TEXT
);

CREATE INDEX IF NOT EXISTS hunk_links_org_id
  ON hunk_links (org_id);

CREATE INDEX IF NOT EXISTS hunk_links_org_event
  ON hunk_links (org_id, event_id);

-- Posted PR Summary content (not "brief")
CREATE TABLE IF NOT EXISTS summaries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  bookmark_id         UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  content             TEXT NOT NULL,
  model               TEXT,
  latency_ms          BIGINT,
  posted_at_ms        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS summaries_org_id
  ON summaries (org_id);

CREATE INDEX IF NOT EXISTS summaries_org_bookmark
  ON summaries (org_id, bookmark_id, posted_at_ms DESC);

-- PR Summary engagement ledger
CREATE TABLE IF NOT EXISTS summary_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  summary_id          UUID NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('view', 'mention', 'override', 'reaction')),
  actor               TEXT,
  created_at_ms       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS summary_events_org_id
  ON summary_events (org_id);

CREATE INDEX IF NOT EXISTS summary_events_summary
  ON summary_events (summary_id, created_at_ms DESC);

-- Full redacted session transcript (line-oriented; encryption in WP-5)
CREATE TABLE IF NOT EXISTS sessions_raw (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  session_id          TEXT NOT NULL,
  tool                TEXT NOT NULL,
  model               TEXT,
  content             TEXT NOT NULL,
  captured_at_ms      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_raw_org_id
  ON sessions_raw (org_id);

CREATE INDEX IF NOT EXISTS sessions_raw_org_session
  ON sessions_raw (org_id, session_id, captured_at_ms DESC);

-- Columnar session events; WP-0 freeze — no JSONB column
-- kind → event_type; old_text/new_text/prompt_context via (raw_id, raw_line) pointer
CREATE TABLE IF NOT EXISTS session_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  session_id          TEXT NOT NULL,
  tool                TEXT NOT NULL,
  model               TEXT,
  ts                  BIGINT NOT NULL,
  event_type          TEXT NOT NULL,
  cwd                 TEXT,
  git_branch          TEXT,
  file_path           TEXT,
  content_hash        TEXT,
  raw_id              UUID REFERENCES sessions_raw(id) ON DELETE SET NULL,
  raw_line            INTEGER,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  request_id          TEXT,
  event_uuid          TEXT,
  parent_uuid         TEXT,
  cli_version         TEXT
);

CREATE INDEX IF NOT EXISTS session_events_org_id
  ON session_events (org_id);

CREATE INDEX IF NOT EXISTS session_events_org_session
  ON session_events (org_id, session_id, ts);

CREATE INDEX IF NOT EXISTS session_events_raw_lookup
  ON session_events (raw_id, raw_line);
