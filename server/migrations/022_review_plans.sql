-- Review plans: LLM-generated narrative + notable changes for /reviews/{bookmarkId}.
-- Usage JSON is computed once from the artifact and persisted alongside the plan.

CREATE TABLE IF NOT EXISTS review_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id),
  bookmark_id     UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  event_id        UUID REFERENCES pr_events(id) ON DELETE SET NULL,
  head_commit_id  TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  plan            JSONB,
  usage           JSONB,
  model           TEXT,
  provider        TEXT,
  error           TEXT,
  latency_ms      BIGINT,
  created_at_ms   BIGINT NOT NULL,
  updated_at_ms   BIGINT NOT NULL,
  UNIQUE (bookmark_id, head_commit_id)
);

CREATE INDEX IF NOT EXISTS review_plans_org_bookmark
  ON review_plans (org_id, bookmark_id, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS review_plans_bookmark_status
  ON review_plans (bookmark_id, status);
