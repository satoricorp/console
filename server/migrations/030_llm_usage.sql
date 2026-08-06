-- Per-call LLM usage ledger. Append-only like review_usage: one row per
-- upstream model invocation, whether proxied for the CLI (/gx/bedrock/fight,
-- /gx/openai/*) or made by this server itself (PR summaries, review plans,
-- @gx mention replies).
--
-- org_id carries no FK to orgs: metering writes are fire-and-forget, and a row
-- must survive placeholder org ids (the cloud-api-key default org has no orgs
-- row) and later org deletion. Losing usage rows silently is the failure mode
-- this table exists to close.
CREATE TABLE IF NOT EXISTS llm_usage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  user_id            TEXT NOT NULL,
  session_id         TEXT,
  machine_id         TEXT,
  -- Which surface made the call (cli, mcp, skill, slash-gx — same vocabulary
  -- as code_review_history_runs.client_surface, from the X-GX-Client header).
  -- NULL means the client predates the field.
  surface            TEXT,
  endpoint           TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       BIGINT NOT NULL DEFAULT 0,
  output_tokens      BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens  BIGINT,
  cache_write_tokens BIGINT,
  -- NULL when the model has no pricing rule, never 0: an unpriceable call must
  -- not read as a free one.
  cost_usd           DOUBLE PRECISION,
  created_at_ms      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS llm_usage_org_created
  ON llm_usage (org_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS llm_usage_org_user_created
  ON llm_usage (org_id, user_id, created_at_ms DESC);
