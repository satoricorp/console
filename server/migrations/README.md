# Server migrations (WP-4)

Forward-only Postgres migrations for the consolidated gx server. The original API migrations `001`-`012` now live here with the rest of the server schema.

## Apply order

1. `server/migrations/001_pr_events.sql`
2. `server/migrations/002_user_session_columns.sql`
3. `server/migrations/003_bookmarks.sql`
4. `server/migrations/004_change_reviews.sql`
5. `server/migrations/005_pr_id_upsert.sql`
6. `server/migrations/006_pr_event_payloads.sql`
7. `server/migrations/007_review_usage.sql`
8. `server/migrations/008_semantic_index_status.sql`
9. `server/migrations/009_github_status.sql`
10. `server/migrations/010_conflict_checks.sql`
11. `server/migrations/011_github_app_installations.sql`
12. `server/migrations/012_bookmark_app_summaries.sql`
13. `server/migrations/013_orgs_and_ledger.sql`
14. `server/migrations/014_orgs_backfill.sql`
15. `server/migrations/015_flatten_conflict_checks.sql`
16. `server/migrations/016_flatten_ci_details.sql`
17. `server/migrations/017_git_blame_context.sql`
18. `server/migrations/018_bookmarks_branch_unique.sql`
19. `server/migrations/019_code_review_history.sql`
20. `server/migrations/020_reported_logs.sql`
21. `server/migrations/021_reported_logs_identity.sql`
22. `server/migrations/022_review_plans.sql`
23. `server/migrations/023_github_post_skips.sql`
24. `server/migrations/024_org_members.sql`
25. `server/migrations/025_bookmark_archived.sql`
26. `server/migrations/026_watch_posts.sql`
27. `server/migrations/027_publish_schema_version.sql`
28. `server/migrations/028_drop_porcelain_tables.sql`
29. `server/migrations/029_review_client_surface.sql`

### Applying the chain

Use `cd server && bun run test:db`. It recreates a scratch database and applies
every migration through the server's own `runMigrations()` — the same code path
`bun run migrate` uses in production — then runs the suite against it. Prefer
that over hand-rolled `psql` loops, which skip `schema_migrations` bookkeeping
and drift out of date.

## No unique index on (org_id, repo_full_name, github_pr_number)

`server/test/publish.test.ts` used to `CREATE UNIQUE INDEX` on that triple in
its `beforeAll`. No migration creates it, so every test ran against a schema
production does not have — and the state the index forbids is the state
production is actually in (duplicate `(org, repo, PR)` bookmark rows exist in
the dev database today). That made the publish upsert's multi-row `UPDATE`
unreachable under test.

The index has been removed from the test rather than promoted to a migration:
adding it would abort the migration chain on any database holding duplicates,
and de-duplicating them is a data decision, not a schema one. The invariant is
maintained in application code instead — see the webhook-takeover path in
`src/routes/publish.ts` that clears a conflicting row's PR number. If that
proves insufficient, the fix is a repair migration that de-duplicates first,
then adds the constraint; do not re-add the index to a test.

### Verify script

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/test/migrations/ledger_joins_test.sql
```

## Table inventory

Created in 001–012: `pr_events`, `pr_event_payloads`, `bookmarks`, `change_reviews`, `review_usage`, `conflict_checks`, `issues`, `github_app_installations`, `github_app_repositories`.

Added in 013: `orgs`, `pr_comments`, `decisions`, `rules`, `outcomes`, `hunk_links`, `summaries`, `summary_events`, `sessions_raw`, `session_events`.

Child tables in 015–016: `conflict_files`, `conflict_check_diagnostics`, `bookmark_ci_checks`.

## Org backfill (014)

1. Insert one `orgs` row per `github_app_installations` row (`installation_id` UNIQUE).
2. Map `bookmarks.org_id` via `repo_full_name` → `github_app_repositories.full_name` → `orgs.installation_id`.
3. Propagate `org_id` to `change_reviews`, `review_usage`, `issues`, `conflict_checks` via `bookmark_id`.
4. Backfill `pr_events.org_id` via `bookmarks.latest_event_id` and matching `github_pr_url`.
5. Rows without installation mapping get a **bootstrap org** (`installation_id IS NULL`, `plan = 'free'`).
6. `pr_events.org_id` stays nullable for orphan events; WP-5 ingest backfill completes the chain.

## `review_usage` org metering

Primary key changed from `(user_id, bookmark_id)` to `(org_id, bookmark_id)` for org-scoped counting:

```sql
SELECT org_id, COUNT(*) AS summary_count
FROM review_usage
GROUP BY org_id;
```

Supports free-trial metering (unlimited PR Summaries during the trial window).

## `session_events` text retrieval (Option A)

**Chosen approach:** line-oriented `sessions_raw.content` with `raw_line` integer pointer.

- Each line in `sessions_raw.content` is one JSONL record or promoted text blob.
- `session_events.content_hash` stores a digest of the resolved text for dedup.
- `old_text`, `new_text`, `prompt_context` (WP-0 mapped fields) resolve via `(raw_id, raw_line)` — no inline TEXT columns, no `raw_json` column.

Lookup:

```sql
SELECT split_part(sr.content, E'\n', se.raw_line) AS event_text
FROM session_events se
JOIN sessions_raw sr ON sr.id = se.raw_id
WHERE se.id = $1;
```

WP-0 overflow fields (`usage`, `uuid`, `structuredPatch`, etc.) remain in transcript lines only — not queryable columns.

## WP-0 column deltas

| WP-0 `proposed_session_events_columns` | `session_events` column | Notes |
|----------------------------------------|---------------------------|-------|
| `session_id` | `session_id` | unchanged |
| `tool` | `tool` | added (org isolation) |
| `model` | `model` | unchanged |
| `ts` | `ts` | BIGINT ms (not ISO string) |
| `kind` | `event_type` | renamed |
| `file_path` | `file_path` | unchanged |
| `old_text` | — | via `(raw_id, raw_line)` |
| `new_text` | — | via `(raw_id, raw_line)` |
| `prompt_context` | — | via `(raw_id, raw_line)` |
| `raw_json` | — | **dropped**; overflow in `sessions_raw` lines |
| — | `content_hash` | dedup digest |
| — | `cwd`, `git_branch`, `cli_version` | from overflow inventory |
| — | `tokens_in`, `tokens_out`, `request_id`, `event_uuid`, `parent_uuid` | from overflow inventory |
| — | `org_id` | org isolation key |

## `hunk_links.event_id` convention

`hunk_links.event_id` FK references `pr_events.id` (the push/extract event that produced the hunk match). WP-1 upload sends `{file, lineStart, lineEnd, sessionId, matchTier, confidence, authorship, tool, model}`; ingest (WP-5) binds `event_id` to the parent `gx.pr` event row.

## Legacy JSONB (not dropped in WP-4)

| Column | Status |
|--------|--------|
| `pr_events.payload` | DEPRECATED — drop after WP-5 promotion |
| `conflict_checks.conflicted_files` | DEPRECATED — read `conflict_files` child table |
| `conflict_checks.diagnostics` | DEPRECATED — read `conflict_check_diagnostics` |
| `bookmarks.ci_details` | DEPRECATED — read `bookmark_ci_checks` |

No new JSONB columns in migrations 013+.

## Example acceptance queries

### Ledger join on `(org_id, bookmark_id)`

```sql
SELECT
  pc.body AS comment_body,
  d.action AS decision_action,
  r.rule_text,
  o.kind AS outcome_kind
FROM pr_comments pc
JOIN decisions d ON d.org_id = pc.org_id AND d.bookmark_id = pc.bookmark_id
JOIN rules r ON r.org_id = pc.org_id
JOIN outcomes o ON o.org_id = pc.org_id AND o.bookmark_id = pc.bookmark_id
WHERE pc.org_id = $org_id AND pc.bookmark_id = $bookmark_id;
```

### `(raw_id, raw_line)` text lookup

```sql
SELECT split_part(sr.content, E'\n', se.raw_line) AS full_event_text
FROM session_events se
JOIN sessions_raw sr ON sr.id = se.raw_id
WHERE se.raw_id = $raw_id AND se.raw_line = $raw_line;
```
