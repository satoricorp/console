# gx Server (WP-5)

Hono backend for ingest, PR Summary, rules, and APIs. Schema migrations live in `server/migrations` (`001`+).

## WP-5a — local dev

```bash
cd server
bun install
# Edit server/.env with your local DATABASE_URL or PG* values.
bun run migrate
bun run dev   # :3201
```

`bun run dev`, `bun run start`, and `bun run migrate` source the repo-root
`.env` first, then `server/.env`, so server-specific values override shared
local values.

## Tests

```bash
cd server
bun run test:db      # the whole suite, including the database-backed tests
```

`test:db` (`scripts/test-db.sh`) drops and recreates a scratch `gx_console_test`
database, applies migrations `001..028` through the server's own
`runMigrations()`, and runs `bun test` against it. Recreating it every run means
the migration chain is exercised end to end, the same way a fresh production
deploy applies it.

- `bun run test:db:keep` reuses the existing scratch database (faster; the suite
  is written to be re-runnable against a dirty one).
- `bun run test:db -- bun test test/publish.test.ts` runs a single file.
- `GX_TEST_DB_NAME` overrides the database name. It must end in `_test`; the
  script refuses to touch `api` or any other real database. **Never point the
  suite at the dev `api` database** — the first `runMigrations()` call there
  applies the pending `028_drop_porcelain_tables.sql` and drops populated tables.

Plain `bun test` still works and still skips the ~59 database-backed tests, but
it now says so loudly (`test/db-gate.ts`). In CI a missing `DATABASE_URL` is a
hard error rather than a silent skip, so a green run cannot mean "the database
paths never ran". Set `GX_TEST_ALLOW_NO_DB=1` to opt out deliberately.

Requires a local Postgres (`brew services start postgresql@16`) or the
containerized one from the repo root (`docker compose up -d postgres`).

For Bedrock locally, use the simple AWS CLI profile path:

```bash
aws configure --profile gx-local
AWS_PROFILE=gx-local AWS_REGION=us-east-1 aws sts get-caller-identity
```

Server PostHog events (`server/src/telemetry/posthog.ts`): `server.ingest.*`, `server.summary.*`, `server.github.webhook`, `server.index.job`, `server.gx_mention.handled`. See `docs/v1-dogfood.md` for full local dogfood instructions.

### Ingest

Local development does not require `GX_CLOUD_API_KEY` or an `Authorization`
header when `NODE_ENV` is not `production`. `X-User-Id` defaults to
`local-user`; `X-Org-Id` is optional and otherwise defaults to the first local
org.

- `POST /v1/extracts` — hunk links + push metadata
- `POST /v1/sessions` — redacted session transcript → `sessions_raw`
- `GET /health`

## Env vars

| Variable | Slice |
|----------|-------|
| `DATABASE_URL` | all |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE` | all |
| `GX_CLOUD_API_KEY` | deployed/internal auth bypass |
| `AWS_PROFILE`, `AWS_REGION` | Bedrock local dev |
| `GX_POSTHOG_KEY` | telemetry (CLI, server, menubar) |
| `GX_POSTHOG_HOST` | PostHog ingest host (default `https://f.gx.run`) |
| `OPENAI_API_KEY` | WP-5c+ |
| `TURBOPUFFER_API_KEY` | WP-5e |
| `STRIPE_SECRET_KEY` | WP-5f |
