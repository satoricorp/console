-- Cache GitHub-backed git_blame context and normalize PR hunks for fast overlap lookups.
-- This is previous git work, not local CLI git history.

CREATE TABLE IF NOT EXISTS pr_event_commits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  pr_event_id       UUID NOT NULL REFERENCES pr_events(id) ON DELETE CASCADE,
  repo_full_name    TEXT NOT NULL,
  pr_number         INTEGER,
  commit_sha        TEXT NOT NULL,
  parent_shas       TEXT[] NOT NULL DEFAULT '{}',
  authored_at_ms    BIGINT,
  author_login      TEXT,
  message_headline  TEXT,
  commit_url        TEXT,
  created_at_ms     BIGINT NOT NULL,
  UNIQUE (pr_event_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS pr_event_commits_commit
  ON pr_event_commits (org_id, repo_full_name, commit_sha);

CREATE INDEX IF NOT EXISTS pr_event_commits_event
  ON pr_event_commits (org_id, pr_event_id);

INSERT INTO pr_event_commits (
  org_id,
  pr_event_id,
  repo_full_name,
  pr_number,
  commit_sha,
  created_at_ms
)
SELECT
  e.org_id,
  e.id,
  b.repo_full_name,
  b.github_pr_number,
  e.head_commit_id,
  e.created_at_ms
FROM pr_events e
JOIN bookmarks b
  ON b.latest_event_id = e.id
WHERE e.org_id IS NOT NULL
  AND e.head_commit_id IS NOT NULL
  AND e.head_commit_id <> ''
ON CONFLICT (pr_event_id, commit_sha) DO NOTHING;

CREATE TABLE IF NOT EXISTS pr_event_hunks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id),
  pr_event_id         UUID NOT NULL REFERENCES pr_events(id) ON DELETE CASCADE,
  repo_full_name      TEXT NOT NULL,
  pr_number           INTEGER,
  base_sha            TEXT NOT NULL,
  head_sha            TEXT NOT NULL,
  file_path           TEXT NOT NULL,
  previous_file_path  TEXT,
  status              TEXT,
  old_start           INTEGER,
  old_end             INTEGER,
  new_start           INTEGER,
  new_end             INTEGER,
  old_line_range      INT4RANGE NOT NULL,
  new_line_range      INT4RANGE NOT NULL,
  session_id          TEXT,
  authorship          TEXT,
  confidence          REAL,
  tool                TEXT,
  model               TEXT,
  created_at_ms       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS pr_event_hunks_event
  ON pr_event_hunks (org_id, pr_event_id);

CREATE INDEX IF NOT EXISTS pr_event_hunks_file
  ON pr_event_hunks (org_id, repo_full_name, file_path);

CREATE INDEX IF NOT EXISTS pr_event_hunks_old_range
  ON pr_event_hunks USING GIST (old_line_range);

CREATE INDEX IF NOT EXISTS pr_event_hunks_new_range
  ON pr_event_hunks USING GIST (new_line_range);

CREATE TABLE IF NOT EXISTS git_blame_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  repo_full_name    TEXT NOT NULL,
  ref_sha           TEXT NOT NULL,
  file_path         TEXT NOT NULL,
  source_provider   TEXT NOT NULL DEFAULT 'github_graphql',
  fetched_at_ms     BIGINT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_message     TEXT,
  UNIQUE (org_id, repo_full_name, ref_sha, file_path)
);

CREATE INDEX IF NOT EXISTS git_blame_snapshots_lookup
  ON git_blame_snapshots (org_id, repo_full_name, ref_sha, file_path);

CREATE TABLE IF NOT EXISTS git_blame_ranges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id           UUID NOT NULL REFERENCES git_blame_snapshots(id) ON DELETE CASCADE,
  org_id                UUID NOT NULL REFERENCES orgs(id),
  repo_full_name        TEXT NOT NULL,
  file_path             TEXT NOT NULL,
  line_start            INTEGER NOT NULL,
  line_end              INTEGER NOT NULL,
  line_range            INT4RANGE NOT NULL,
  commit_sha            TEXT NOT NULL,
  commit_url            TEXT,
  authored_at_ms        BIGINT,
  author_login          TEXT,
  author_name           TEXT,
  message_headline      TEXT,
  associated_pr_number  INTEGER,
  associated_pr_url     TEXT,
  age                   INTEGER,
  UNIQUE (snapshot_id, line_start, line_end, commit_sha)
);

CREATE INDEX IF NOT EXISTS git_blame_ranges_snapshot
  ON git_blame_ranges (snapshot_id);

CREATE INDEX IF NOT EXISTS git_blame_ranges_commit
  ON git_blame_ranges (org_id, repo_full_name, commit_sha);

CREATE INDEX IF NOT EXISTS git_blame_ranges_file
  ON git_blame_ranges (org_id, repo_full_name, file_path);

CREATE INDEX IF NOT EXISTS git_blame_ranges_line_range
  ON git_blame_ranges USING GIST (line_range);
