-- PR id is client-generated on gx pr and stored as bookmarks.id.
-- Branch names may change without creating a new PR row.
ALTER TABLE bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_user_id_repo_full_name_branch_name_key;

CREATE INDEX IF NOT EXISTS bookmarks_user_repo_branch
  ON bookmarks (user_id, repo_full_name, branch_name);
