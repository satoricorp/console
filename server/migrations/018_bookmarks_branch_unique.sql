CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_repo_branch_unique
  ON bookmarks (user_id, repo_full_name, branch_name);
