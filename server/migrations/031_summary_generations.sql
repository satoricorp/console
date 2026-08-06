-- Append-only per-generation metering for PR Summaries.
--
-- review_usage (007/014) is a quota dedup key — PK (org_id, bookmark_id) with
-- ON CONFLICT DO NOTHING — so regenerations on synchronize pushes are invisible
-- to it. This table records every generation instead. review_usage semantics
-- are unchanged; the "already_counted" quota gate still depends on them.
--
-- user_id is nullable: webhook-triggered generations may not resolve past the
-- publisher sentinels. Token columns are nullable until per-completion usage
-- lands in the LLM layer. Metering rows must outlive their subjects, so the
-- bookmark/summary FKs detach on delete.

CREATE TABLE IF NOT EXISTS summary_generations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id),
  user_id         TEXT,
  bookmark_id     UUID REFERENCES bookmarks(id) ON DELETE SET NULL,
  summary_id      UUID REFERENCES summaries(id) ON DELETE SET NULL,
  source          TEXT NOT NULL CHECK (source IN ('webhook', 'console')),
  model           TEXT,
  input_tokens    BIGINT,
  output_tokens   BIGINT,
  created_at_ms   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS summary_generations_org_created
  ON summary_generations (org_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS summary_generations_org_user_created
  ON summary_generations (org_id, user_id, created_at_ms DESC);
