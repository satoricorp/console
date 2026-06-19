CREATE TABLE IF NOT EXISTS github_app_installations (
  installation_id BIGINT PRIMARY KEY,
  account_id BIGINT,
  account_login TEXT NOT NULL,
  account_type TEXT,
  repository_selection TEXT,
  app_id BIGINT,
  installed_at_ms BIGINT,
  suspended_at_ms BIGINT,
  updated_at_ms BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_app_repositories (
  github_repo_id BIGINT PRIMARY KEY,
  installation_id BIGINT NOT NULL REFERENCES github_app_installations(installation_id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  name TEXT NOT NULL,
  private BOOLEAN,
  default_branch TEXT,
  access_state TEXT NOT NULL DEFAULT 'installed',
  added_at_ms BIGINT,
  removed_at_ms BIGINT,
  updated_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS github_app_repositories_installation_idx
  ON github_app_repositories (installation_id);

CREATE INDEX IF NOT EXISTS github_app_repositories_full_name_idx
  ON github_app_repositories (full_name);
