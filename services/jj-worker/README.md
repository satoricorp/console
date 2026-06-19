# jj-worker

Server-side jj mutation engine for GX Cloud. Applies bookmark operations in a warm jj workspace, pushes to GitHub, and updates bookmark state in Postgres.

## Role in GX Cloud

```text
Console/API save → POST /v1/bookmarks/:id/apply → jj-worker POST /apply
  → jj ops in colocated clone → jj git push --bookmark
  → Postgres revision + remote_head_sha bump → Convex slim index sync
  → local `gx sync` sees new revision and fetches remote tip
```

Postgres remains the system of record for full payloads and sessions. Convex holds a slim bookmark index for the Console home. This service owns jj execution only.

## Environment

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | yes | Postgres (`gx_bookmarks`, joins `gx_pr_events`) |
| `GX_CLOUD_API_KEY` | yes | Service auth for `POST /apply` |
| `GITHUB_TOKEN` | yes for push | GitHub API + authenticated git clone/push |
| `PORT` | no | HTTP listen port (default `3210`) |
| `JJ_WORKSPACE_ROOT` | no | Base path for per-user/repo jj clones (default `~/.gx/jj-workspaces`) |

## Development

Terminal 1 — API (proxy route):

```bash
cd server
cp .env.example .env   # set DATABASE_URL, GX_CLOUD_API_KEY, JJ_WORKER_URL=http://localhost:3210
bun run dev
```

Terminal 2 — jj-worker:

```bash
cd services/jj-worker
export DATABASE_URL=postgres://localhost:5432/gx
export GX_CLOUD_API_KEY=dev-secret
export GITHUB_TOKEN=ghp_...
bun install
bun run dev
```

Requires `jj` and `git` on PATH.

## API

### `GET /health`

Returns `{ ok: true, service: "jj-worker" }`.

### `POST /apply`

Auth: `Authorization: Bearer $GX_CLOUD_API_KEY`

Request body:

```json
{
  "bookmarkId": "uuid",
  "userId": "uuid",
  "ops": [{ "type": "restack" }]
}
```

Supported op types (`src/types.ts`): `relocate_change`, `restack`, `amend`, `squash`, `describe`, `rebase`.

Success (`200`):

```json
{
  "bookmarkId": "uuid",
  "revision": 2,
  "headCommitId": "abc123...",
  "remoteHeadSha": "def456..."
}
```

Errors: `400` invalid body, `401` auth, `404` bookmark, `409` closed bookmark / missing remote, `502` jj failure, `503` missing `GITHUB_TOKEN`.

## Console/API proxy

Authenticated clients call the gx-cloud API instead of jj-worker directly:

```bash
curl -X POST http://localhost:3201/v1/bookmarks/$BOOKMARK_ID/apply \
  -H "Authorization: Bearer $GX_CLOUD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ops":[{"type":"describe","changeId":"@","description":"Updated from server"}]}'
```

## Related docs

- [gx sync contract](../../docs/gx-sync-contract.md)
- GX Cloud Architecture plan — Phase 4
