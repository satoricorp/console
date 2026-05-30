# GX sync contract

Metadata-first sync between GX Cloud (Postgres) and the local gx CLI + jj workspace. Full push payloads are not replayed on every sync.

## What `gx sync` pulls from Postgres

| Field | Source | Purpose |
| ----- | ------ | ------- |
| Bookmark list | `gx_bookmarks` | One row per `(user_id, repo_full_name, branch_name)` |
| `revision` | `gx_bookmarks.revision` | Monotonic counter; local client skips work when already at revision |
| `head_commit_id` | `gx_bookmarks.head_commit_id` | Latest published jj commit for the bookmark |
| `remote_head_sha` | `gx_bookmarks.remote_head_sha` | Last known GitHub branch tip after server push |
| `merge_status` | `gx_bookmarks.merge_status` | `open` \| `merged` \| `closed` — drives home filters |
| `title` | `gx_bookmarks.title` | Display title (user-editable via Console) |
| Session associations | `gx_pr_events.payload.sessions` (latest event) | Immutable session content; links may move between bookmarks |
| New console sessions | Future ingest API | Append-only; same `PushBundle.sessions` shape |

Convex is **not** part of the sync path. The CLI talks to gx-cloud API (Postgres) directly.

## Revision semantics

1. Every successful publish or server-side mutation bumps `gx_bookmarks.revision`.
2. `gx sync` stores the last seen revision per bookmark locally (gx.db).
3. When `remote_revision > local_revision`, the client fetches bookmark metadata and applies catch-up steps below.
4. Full event payloads are fetched on demand (`GET /bookmarks/:id?include_payload=1`), not on every sync poll.

## Local jj catch-up

When `remote_head_sha` differs from the local bookmark tip:

```bash
jj git fetch
# reconcile local bookmark to remote tip before applying new ops
```

If GX Cloud applied server-side jj ops (Phase 4 worker), the client pulls the new tip via fetch rather than replaying ops locally.

## Publish path (today)

Until server jj is production-ready:

- **Publish:** `gx pr` → `POST /gx/pr` → append event + upsert bookmark + slim Convex sync
- **Sync:** metadata only; no automatic full payload download unless revision changed

Console structural saves will queue jj-worker jobs in Phase 4; until then Console remains read-only for stack edits.

Implemented path (dev):

- `POST /bookmarks/:id/apply` on gx-cloud API (authenticated)
- Proxies to `jj-worker POST /apply` with service key
- Worker runs jj ops, pushes bookmark, bumps Postgres `revision` and `remote_head_sha`

## Conflict policy

Conflict resolution (divergent local jj vs server revision, concurrent edits) is **out of scope** for this document. See the separate conflict design doc when published. Phases 1–3 do not block on it.

## Exit criteria (Phase 4)

- One server-side jj operation (e.g. restack) applied in dev
- GitHub branch matches updated bookmark `remote_head_sha`
- `gx sync` receives new revision without full payload replay
