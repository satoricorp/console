CREATE TABLE IF NOT EXISTS pr_event_payloads (
  event_id     UUID PRIMARY KEY REFERENCES pr_events(id) ON DELETE CASCADE,
  encoding     TEXT NOT NULL,
  payload      BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

