# GX Server (WP-5)

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
| `GX_POSTHOG_HOST` | PostHog ingest host (default `https://us.i.posthog.com`) |
| `OPENAI_API_KEY` | WP-5c+ |
| `TURBOPUFFER_API_KEY` | WP-5e |
| `STRIPE_SECRET_KEY` | WP-5f |
