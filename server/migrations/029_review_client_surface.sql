-- Which surface invoked the review: cli, mcp, skill, or slash-gx. Recorded so
-- "reviews per person" can be split by entry point instead of undercounting
-- agent-driven runs. NULL means the CLI predates the field.
ALTER TABLE code_review_history_runs ADD COLUMN IF NOT EXISTS client_surface TEXT;
