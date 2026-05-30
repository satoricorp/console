-- PR id is client-generated on gx pr and stored as gx_bookmarks.id.
-- Branch names may change without creating a new PR row.
ALTER TABLE gx_bookmarks
  DROP CONSTRAINT IF EXISTS gx_bookmarks_user_id_repo_full_name_branch_name_key;

CREATE INDEX IF NOT EXISTS gx_bookmarks_user_repo_branch
  ON gx_bookmarks (user_id, repo_full_name, branch_name);
