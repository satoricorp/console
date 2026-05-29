# GX sync contract

Metadata-first sync between GX Cloud (Postgres) and the local gx CLI + jj workspace. Full push payloads are not replayed on every sync unless the stack structure may have changed.

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
4. Full event payloads are fetched on demand (`GET /bookmarks/:id?include_payload=1`), not on every metadata-only sync poll.

### Structural edits (split, restack with stack changes)

When Console or the API applies jj ops that **change stack structure** (e.g. split to own change):

1. jj-worker runs the op in the server workspace and exports a fresh `PushBundle`-shaped stack snapshot (no GitHub push).
2. gx-cloud **appends a new `gx_pr_events` row** with the updated `payload.stack[]`.
3. `gx_bookmarks.latest_event_id`, `revision`, and `head_commit_id` are updated in the same transaction. `remote_head_sha` is unchanged until the user runs `gx pr --github` or lands from Console.
4. Convex receives a **stack-only** copy of the payload for Console display (diffs, stack review). Captured **sessions stay in Postgres only** — not trimmed, not replicated to Convex.

Local clients should treat a revision bump after a structural edit as requiring a **full payload fetch**:

```bash
# When remote_revision > local_revision and stack may have changed:
GET /bookmarks/:id?include_payload=1
jj git fetch   # only needed after gx pr --github or land updated the remote
# reconcile local bookmark to remote tip when remote_head_sha changed
```

Metadata-only sync is still sufficient for title/merge-status-only changes that do not append a new event with a refreshed stack.

## Local jj catch-up

When `remote_head_sha` differs from the local bookmark tip:

```bash
jj git fetch
# reconcile local bookmark to remote tip before applying new ops
```

If GX Cloud applied server-side jj ops (jj-worker), the client pulls the new tip via fetch rather than replaying ops locally.

## Publish path

- **Upload review context:** `gx pr` → `POST /gx/pr` → append event + upsert bookmark + slim Convex sync (does **not** push to GitHub)
- **Push to GitHub:** `gx pr --github` → same upload path plus `git push` of the body branch; updates `remote_head_sha` on the next ingest when the client records the push
- **Sync:** metadata by default; fetch full payload when revision changed and stack structure may differ

## Console structural edits

- `POST /bookmarks/:id/split-to-change` — split files or line ranges from the current stack change into a new change (split-in-place)
- `POST /bookmarks/:id/apply` — general jj-worker ops; when the worker returns `stackPayload`, same ingest path as split (new event + payload refresh)

Both paths:

- Proxy to `jj-worker POST /apply` with service key
- Worker runs jj ops in the server workspace and exports stack when applicable (no automatic GitHub push)
- API ingests event, bumps Postgres `revision`, syncs Convex with latest payload

## Conflict policy

Conflict resolution (divergent local jj vs server revision, concurrent edits) is **out of scope** for this document. See the separate conflict design doc when published. Phases 1–3 do not block on it.

## Exit criteria (Phase 4)

- One server-side jj operation (e.g. restack) applied in dev
- GitHub branch matches updated bookmark `remote_head_sha`
- `gx sync` receives new revision and can refresh stack via `include_payload=1` when structure changed
