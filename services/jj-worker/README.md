# jj-worker

Server-side jj mutation engine for GX Cloud. Applies bookmark operations in a warm jj workspace, pushes to the configured remote, and updates bookmark state in Postgres.

**Status:** scaffold only. `POST /apply` returns 501 until workspace pooling and jj command wiring land.

## Role in GX Cloud

```text
Console save → Postgres (revision bump) → jj-worker /apply
  → jj ops in colocated clone → jj git push --bookmark
  → GitHub adapter updates remote_head_sha → gx sync picks up new revision
```

Postgres remains the system of record for full payloads and sessions. Convex holds a slim bookmark index for the Console home. This service owns jj execution only.

## Environment

| Variable | Purpose |
| -------- | ------- |
| `PORT` | HTTP listen port (default `3210`) |
| `DATABASE_URL` | Postgres (future: bookmark fetch + revision update) |
| `GX_CLOUD_API_KEY` | Service auth to gx-cloud API (future) |
| `JJ_WORKSPACE_ROOT` | Base path for per-user/repo jj clones (future) |

## Development

```bash
cd services/jj-worker
bun install
bun run dev
```

## API (stub)

### `GET /health`

Returns `{ ok: true, service: "jj-worker" }`.

### `POST /apply`

Request body:

```json
{
  "bookmarkId": "uuid",
  "userId": "uuid",
  "ops": [{ "type": "restack" }]
}
```

Supported op types are defined in `src/types.ts` (`relocate_change`, `restack`, `amend`, `squash`, `describe`, `rebase`).

Until implemented, responds with `501 Not implemented`.

## Related docs

- [gx sync contract](../../docs/gx-sync-contract.md) — metadata sync between Postgres and local jj
- GX Cloud Architecture plan — Phase 4
