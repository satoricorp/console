# Plan: Full-source review context + honest attribution

Goal: PR summaries, review plans, and @gx chat replies draw on all four evidence
buckets — **agent sessions, codebase, previous PRs, independent resources** — and
the attribution shown to users reflects what the model was actually given, with
hard tenant isolation (no org can ever read another org's indexed data).

## Current state (verified in code, 2026-07-12)

| Surface | Context it actually uses | Turbopuffer? |
|---|---|---|
| Review plan (`server/src/review-plan/context.ts`) | pr_event payload (patches, sessions, provenance), hunk_links | No |
| PR summary (`server/src/summary/generate.ts`) | payload revisions/sessions, hunk_links, session_events | No (`indexSnippets` field exists, never populated) |
| @gx chat (`server/src/gx-mention/handler.ts`) | same `loadExtractContext`; "Indexed codebase context" prompt section always "(none)" | No |
| CLI `/v1/review/context` (`server/src/routes/review.ts`) | rules, hunk_links, collisions + `searchIndex` | Yes — org/repo namespace |
| CLI local review (`~/git/gx/internal/codereview/review_resources.go`) | `gx-sessions` (`code_file`, `session_transcript`, `session_context`, filter `repo_root`) + `gx-review-knowledge` (`review_corpus`) | Yes — but console server never touches these |

Attribution today: `attributionSources` is an LLM self-estimate
(`server/src/llm/prompts/review-plan.ts` says "not measured"), with a hardcoded
70/20/5/5 fallback in `server/src/review-plan/validate.ts` when the model omits
it. The model is never shown codebase, previous-PR, or docs context, so three of
the four buckets it reports are unsupported.

Security today: `requireAuth` (`server/src/middleware/auth.ts`) trusts the
client-supplied `X-Org-Id` header with **no membership check** for the
CLI-session and GitHub-token paths, and `resolveGitHubToken` accepts any valid
GitHub token from any user. There is no `org_members` table. Any authenticated
user can read any org's rules, hunk links, and index via `/v1/review/context`.

Namespaces in play:

- `gx-{orgId}-{repoSlug}` — console server writes: `push_delta`, `hunk_link`,
  `published_revision_diff`, `published_session_context`,
  `code_review_summary`, `code_review_history` (`server/src/indexing/*`)
- `gx-sessions` — gx CLI writes: `code_file`, `session_transcript`,
  `session_context`; filtered only by client-supplied `repo_root`/attributes
- `gx-review-knowledge` — shared, non-tenant `review_corpus` (independent
  resources; the OWASP-style content promised in
  `src/components/home/features-section.tsx`)

---

## Phase 0 — Tenant isolation (blocker; nothing else ships before this)

### 0.1 Org membership

- Migration `024_org_members.sql`:
  `org_members(
     org_id uuid,
     github_user_id bigint NOT NULL,
     convex_user_id text,
     role text default 'member',
     source text,
     created_at_ms bigint,
     PRIMARY KEY (org_id, github_user_id)
   )`.
- Populate (**bootstrap = Eng 1A**):
  - On `installation.created`: insert webhook **sender** as `role=admin`,
    `source=github_install`.
  - On install + membership sync: list org members via installation token;
    upsert `source=github_sync`. Personal (non-org) installs: sender only.
  - Invite path for users who are not on the GitHub member list.
  - CLI first-auth does **not** auto-insert membership; requires an existing
    row matched by `github_user_id` from `/cx/auth/cli/verify`.
- Backfill script for existing orgs (GitHub ids from known actors) —
  reviewed by a human before running in prod.

### 0.2 Enforce in `requireAuth`

- After identity resolution: if `X-Org-Id` is present, require
  `org_members` row for `(orgId, github_user_id)`; otherwise 403. Never fall
  back to the header value alone. CLI uses `AuthContext.githubUserId`; GitHub
  bearer parses id from `github:{id}`.
- `resolveGitHubToken`: a valid GitHub token no longer suffices. The resolved
  GitHub user id must map to a member of the requested org.
- `withDefaultOrg` only when `localDevAuthEnabled()` (`NODE_ENV !== production`
  and no `GX_CLOUD_API_KEY`). Missing `X-Org-Id` in prod → reject. Assert + log
  so local-dev can never be active in prod.
- Cloud API key path (`resolveCloudApiKey`) is trusted infrastructure; skip
  membership, but log org access with `tokenLabel` for audit.

### 0.3 Defense-in-depth on every turbopuffer query

- `searchIndex` (`server/src/indexing/turbopuffer.ts`): change filter to
  `["And", [["org_id","Eq",orgId],["repo_full_name","Eq",repoFullName]]]`.
  `org_id` is already written on every chunk.
- The retrieval broker (Phase 1) is the only module allowed to construct
  namespace names, and only from the server-derived `auth.orgId` — never from
  request params. Lint/grep check in CI: `namespaceForOrgRepo(` callers
  restricted to `indexing/` + broker.
- The shared `gx-review-knowledge` namespace is read-only, contains no tenant
  data, and is queried with a filter `["source_kind","Eq","review_corpus"]`.
  Use a separate read-only turbopuffer key for it if key scoping is available.

### 0.4 Phase 0 tests (must pass before Phase 1 merges)

- Unit (`server/test/auth.test.ts`, new): every auth path × spoofed
  `X-Org-Id` → 403; member → 200; missing header → default-org only in dev
  mode; prod-mode env combination never yields `local-dev` auth.
- Integration: seed two orgs A/B with indexed data (use the existing
  `setIndexingFetch` seam + fake tpuf server as in `server/test/indexing.test.ts`);
  authenticated as A-member, request B's `/v1/review/context`, summary, review
  plan, and gx-mention routes → all 403, and assert the fake tpuf server
  received **zero** requests for B's namespace.
- Query-shape regression: assert every captured tpuf query body includes the
  `org_id` Eq filter.
- Red-team script (checked into `server/test/security/`): matrix of
  {cloud key, gxcs token, GitHub token, no token} × {own org, other org,
  garbage org, missing header} × all authed routes. Run in CI; output table in
  the PR description of the security change.

**Acceptance:** red-team matrix fully green; a second engineer (not the author)
reviews the auth diff; deploy to staging and re-run the matrix against staging
before prod.

---

## Phase 1 — Retrieval broker (one module, four buckets)

### 1.1 `server/src/context/broker.ts`

```
retrieveReviewContext(db, {
  orgId, repoFullName, repoRootPath,
  queryTerms: { intent, changedFiles, symbols, branch },
  limits?: { perBucket?: number, totalChars?: number }
}) => {
  buckets: {
    "agent-sessions":  Snippet[],   // published_session_context + session_transcript/session_context once ingested (1.3)
    "codebase":        Snippet[],   // code_file chunks (1.3) + push_delta/hunk_link as fallback
    "previous-prs":    Snippet[],   // published_revision_diff, code_review_summary, code_review_history
    "docs":            Snippet[],   // REVIEW.md (repo policy) + gx-review-knowledge review_corpus
  },
  manifest: { bucket: { provided: number, chars: number } },
}
```

- `Snippet = { id, bucket, sourceKind, text, score, file?, lines? }` with a
  stable citation id (`C1…`, `P1…`, `D1…`, `A1…` per bucket).
- **`REVIEW.md` (required product behavior):** repo-root review policy already
  used by local `gx review` (`~/git/gx/internal/codereview/review_policy.go`).
  Console does **not** read it today — fix that in the broker. This is the
  "custom docs" path; do **not** invent a separate per-org docs corpus.
  - Prefer indexed `source_kind: "review_policy"` chunks in the org namespace
    (written on push/index when `REVIEW.md` exists at repo root).
  - Fallback: fetch `REVIEW.md` via GitHub Contents API at the PR/head SHA
    using the installation token (same install already used for webhooks).
  - Cap ~8KB text (match CLI `maxReviewPolicySummaryBytes`). Citation id `D1`
    (or `R1` if we want policy distinct in UI — default `D*` under docs).
  - Prompt ordering inside the docs section: **REVIEW.md first**, then
    independent `review_corpus` hits (matches CLI priority in
    `scripts/review-knowledge/README.md`).
  - If absent: docs bucket may still have corpus hits; manifest stays honest.
- One embedding call for the query text, then parallel namespace queries
  (org/repo namespace + knowledge namespace). Per-bucket `source_kind`
  filters; per-bucket top-k (default 8) and char caps (default 1,200/snippet,
  ~10k total) mirroring the CLI's `defaultIndexedContextLimit` conventions.
  For docs: reserve budget for REVIEW.md before corpus top-k.
- Fail open per bucket: a bucket that errors returns empty **and is recorded in
  the manifest as `provided: 0`** so attribution can never claim it.
- In-process memo (**Eng Perf 1A**): TTL ~30–60s keyed by
  `(orgId, repoFullName, queryHash)` so summary+plan on the same PR share one
  embed/ANN round-trip.
- Config: reuse `indexingConfig()`; add
  `GX_REVIEW_KNOWLEDGE_NAMESPACE` (default `gx-review-knowledge`) to match the
  CLI's `GX_REVIEW_KNOWLEDGE_NAMESPACE`.

### 1.1b Index `REVIEW.md` on push

- In `buildIncrementalChunks` / publish indexing: if the push or tree includes
  root `REVIEW.md`, upsert chunks with `source_kind: "review_policy"`,
  `file: "REVIEW.md"`. Idempotent via `chunk_hash`.
- Allowlist for `/v1/index/chunks` (**Eng 3A**) also accepts `review_policy`
  so CLI sync can push it the same way as `code_file`.

### 1.2 Decide: how the server reaches `code_file` / transcript chunks

The CLI writes these to `gx-sessions` with client-supplied attributes; the
server must not treat that as a tenant boundary. Recommended: **route CLI
semantic indexing through the server.**

- New endpoint `POST /v1/index/chunks` (auth required): accepts pre-chunked
  text + attributes, server stamps `org_id`, embeds, and upserts into
  `gx-{orgId}-{repoSlug}` with `source_kind` preserved.
- Trust boundary (**Eng 3A**): allowlist
  `source_kind ∈ {code_file, session_transcript, session_context, review_policy}`;
  max chunks/request + per-org bytes/day; `repo_full_name` must belong to the
  org's GitHub installation. Reject with 400/429 otherwise. Client-sent
  `org_id` is overwritten.
- gx CLI change (`~/git/gx/internal/semantic/`): when authenticated against
  api.gx.run, send chunks to `/v1/index/chunks` instead of writing turbopuffer
  directly. Keep direct-write mode for standalone/local use
  (`GX_TPUF_NAMESPACE` unset ⇒ server mode).
- Backfill: one-shot job reindexes each org's repos on next `gx sync`/push (the
  chunker is deterministic — `chunk_hash` attribute enables idempotent upsert).
- Interim (until CLI ships): broker's codebase bucket falls back to
  `push_delta`/`hunk_link` chunks already in the org namespace, and the
  manifest labels the bucket `codebase (history only)` so attribution stays
  honest.

### 1.3 Phase 1 tests

- Broker unit tests with fake tpuf fetch: bucket routing by `source_kind`,
  caps enforced, per-bucket failure isolation, manifest correctness, citation
  id stability.
- Docs bucket: when `review_policy` / Contents fetch returns REVIEW.md, it
  appears first in docs snippets; when absent, corpus-only still works.
- `/v1/index/chunks`: org stamping (client-sent `org_id` attribute is
  overwritten), size limits, auth, idempotency by `chunk_hash`, allowlist
  includes `review_policy`.
- Cross-tenant re-run: the Phase 0 two-org integration test extended to the
  broker — org A's broker call must never emit a query to org B's namespace,
  and the knowledge namespace query must carry the `review_corpus` filter.

**Acceptance:** broker returns non-empty buckets for a seeded fixture repo with
all four source kinds present; latency of the full broker call ≤ 1.5s p95
against the fake store with realistic payload sizes (queries parallelized).

---

## Phase 2 — Wire the broker into all three generators

### 2.1 PR summary

- `loadExtractContext` (`server/src/summary/generate.ts`): call the broker;
  populate the already-declared `indexSnippets` (keep type, add `bucket`).
- `buildPRSummaryUserPrompt` (`server/src/llm/prompts/pr-summary.ts`): render
  labeled sections per bucket with citation ids, under the existing byte-budget
  pattern; add the manifest line
  `Context provided: agent-sessions=N codebase=N previous-prs=N docs=N`.
- Provenance section rule in `PR_SUMMARY_SYSTEM_PROMPT`: cite buckets that were
  provided; never name a bucket with `provided: 0`.

### 2.2 Review plan

- `loadReviewPlanContext` (`server/src/review-plan/context.ts`): add broker
  call; new fields `contextBuckets` + `contextManifest` on `ReviewPlanContext`.
- `buildReviewPlanUserPrompt`: sections
  `## Codebase context`, `## Previous PRs`, `## Independent resources`, each
  listing snippets with ids; manifest line as above.
- System prompt change: `attributionSources` must be computed **only over
  buckets listed in "Context provided"**, and each `notableChange` gains an
  optional `evidence: ["C2","D1"]` array citing snippet ids.

### 2.3 @gx chat

- `gx-mention/handler.ts`: populate `context.indexSnippets` from the broker so
  the existing "Indexed codebase context" section and the citation machinery in
  `gx-mention/citations.ts` finally light up. No prompt changes needed beyond
  bucket labels.

### 2.4 CLI `/v1/review/context` (**Eng 4A**)

- `loadReviewContext` calls the same broker (via `attachBrokerContext`).
  Map buckets into existing `indexSnippets` for back-compat; optionally add
  `buckets` / `manifest` fields on the JSON response for newer CLI clients.

### 2.5 Shared attach helper (**Eng CQ 1A**)

- All four loaders call one helper around `retrieveReviewContext` so caps,
  citation ids, and manifest shape cannot drift.

### 2.6 Phase 2 tests

- Prompt-builder snapshot tests: all buckets present / some empty / all empty
  (output must degrade to today's behavior when the index is disabled —
  `indexingConfig() === null` path stays green).
- End-to-end with mock provider: seeded Postgres + fake tpuf → generate summary
  and plan → assert prompt contained the bucket sections and manifest.
- Latency guard: summary + plan generation p95 budget increase ≤ 2s with the
  broker enabled; broker runs concurrently with the Postgres context loads.
- CLI context route: response snippets come from broker; cross-tenant still 403.
- Broker memo (**Eng Perf 1A**): two calls with same key within TTL return
  identical manifest without a second embed (assert via fake fetch counts).

---

## Phase 3 — Honest attribution

### 3.1 Clamp to the manifest (estimated mode, default)

- Extend `ATTRIBUTION_SOURCES` with **`pr-payload`** (**Eng CQ 2C**) for
  non-indexed PR/session payload evidence. Do **not** fold payload chars into
  `agent-sessions`.
- `parseAndValidateReviewPlan` (`server/src/review-plan/validate.ts`):
  - Drop/zero any `attributionSources` entry whose bucket has `provided: 0`
    (except `pr-payload`, which is allowed when payload context was in the
    prompt); renormalize to 100.
  - **Delete the hardcoded 70/20/5/5 fallback.** Fallback = char-weighted over
    non-empty broker buckets + `pr-payload` when payload evidence was present.
    If only payload → `[{ source: "pr-payload", pct: 100 }]`.
  - Validate `notableChanges[].evidence` ids exist in the manifest; strip
    unknown ids (same posture as gx-chat citations).

### 3.2 Measured mode (flag: `GX_MEASURED_ATTRIBUTION=1`)

- Compute percentages from `evidence` citation counts (weighted by bucket),
  not the model's estimate; store `attributionMode: "measured" | "estimated"`
  on the plan JSON (schema stays v1-compatible — additive field).
- Iterate on the golden set (Phase 4) until measured mode's bucket ranking is
  stable across reruns (see eval loop), then flip the default.

### 3.3 UI + GitHub comment

- `src/components/reviews/narrative-section.tsx`: hide zero-pct buckets;
  tooltip text switches on `attributionMode` ("Estimated — not measured" vs
  "Measured from cited evidence"). Update `src/lib/reviews-client.ts` types and
  `src/lib/demo-review.ts` fixture.
- PR summary GitHub comment Provenance section gains an explicit footer, e.g.
  `Sources: agent sessions (5) · codebase (3) · previous PRs (2) · independent resources (1)`
  — counts from the manifest, not the model.
- Revisit `src/components/home/features-section.tsx` copy once docs retrieval
  is live so the OWASP claim is true (it will be, via `gx-review-knowledge`).

### 3.4 Phase 3 tests

- validate.ts unit tests: claimed-but-not-provided bucket zeroed; fallback
  proportional to manifest; measured mode math; evidence id stripping.
- UI: component test for zero-bucket hiding and tooltip mode switch.

---

## Phase 4 — Eval loop, rollout, and iteration

This is not a one-shot ship. Budget at least two full iteration cycles on the
prompts/attribution before GA.

### 4.1 Golden-set eval (new: `server/test/eval/`)

- Capture ~10–15 real bookmarks/PRs (mix: agent-heavy, human-heavy, docs-relevant
  e.g. security-touching changes, repos with rich review history, and a repo
  with an empty index) as replayable fixtures.
- Runner: regenerate plan + summary with `force: true` against fixtures, score:
  1. schema-valid plan; 2. `attributionSources ⊆ provided buckets ∪ {pr-payload}`;
  3. every `evidence` id resolves; 4. summary passes `validateSummary`;
  5. rerun variance — same fixture 3×, bucket **ranking** must be stable
     (percentages may wobble; order must not).
- **PR gate (**Eng Test 1A**):** checks 1–4 (deterministic) block merge on PRs
  touching `llm/prompts/`, `review-plan/`, `summary/`, or `context/`.
- **Nightly:** full rubric including check 5. Required green for N days before
  flipping measured-mode default or GA.
- Iterate: adjust prompt wording / snippet formatting / top-k until the rubric
  passes ≥ 95% across the set; log each iteration's scores in the plan PR.

### 4.2 Observability

- PostHog events (`server/src/telemetry/posthog.ts`): add
  `ContextBucketsProvided` (per generation: counts/chars per bucket, broker
  latency), `AttributionClamped` (model claimed an unprovided bucket — this is
  the hallucination-rate metric; watch it trend to ~0 in measured mode).
- Structured log on every broker call: namespaces queried (must only ever be
  the caller's org namespace + knowledge namespace) — feeds a weekly audit
  query.

### 4.3 Staged rollout (flag: `GX_CONTEXT_BROKER=1`)

1. Dev with mock provider + fake tpuf (CI).
2. Staging, internal org only; run the security red-team matrix **again**
   against staging with real turbopuffer.
3. Prod, internal org (satoricorp) for ≥ 1 week; review
   `AttributionClamped` rate, broker latency p95, and spot-check 10 generated
   plans by hand against their PRs.
4. Prod GA. Kill switch: unset flag reverts to the legacy context path (all
   broker call sites must no-op cleanly when the flag is off — covered by the
   "all buckets empty" snapshot tests).

### 4.4 Sequencing / dependencies

```
0.1 → 0.2 → 0.4 red-team ─┐
0.3 ──────────────────────┼→ 1.1 broker → 1.3 tests → 2.x wiring → 3.x attribution → 4.x eval+rollout
CLI /v1/index/chunks (1.2) ┘        (codebase bucket upgrades from "history only"
                                     to real code_file chunks when CLI ships;
                                     no console changes needed at that point)
```

Phase 0 ships alone as its own PR(s) and deploys first. Phases 1–3 can be one
stacked series behind the flag. The gx CLI change (1.2) is a separate repo/PR
(`~/git/gx`) and can land in parallel after `/v1/index/chunks` exists.

## Eng review decisions (2026-07-12)

Scope: **full plan as written (option B)** — Phase 0 still ships/deploys alone first.

| ID | Decision |
|---|---|
| Arch 1A | Membership bootstrap: on `installation.created` insert sender as `admin` (`source=github_install`); sync org members via installation token (`source=github_sync`); invite path for non-GitHub; CLI first-auth requires existing membership. |
| Arch 2A | `org_members` keyed by `(org_id, github_user_id bigint NOT NULL)`; optional `convex_user_id`; CLI/GitHub auth resolve membership via GitHub id; cloud API key remains membership-exempt (trusted infra). |
| Arch 3A | `/v1/index/chunks`: allowlist `source_kind ∈ {code_file, session_transcript, session_context}`; batch + per-org rate limits; repo must belong to org's installation. |
| Arch 4A | CLI `loadReviewContext` consumes the broker (flat `indexSnippets` and/or bucketed response; back-compat OK). |
| CQ 1A | Shared `attachBrokerContext` / direct `retrieveReviewContext` from all loaders — one place owns caps, manifest, citation ids. |
| CQ 2C | Fifth attribution source `pr-payload` for non-indexed PR/session payload evidence; do not inflate `agent-sessions` with payload chars. |
| Test 1A | PR gate = deterministic rubric (schema, attribution ⊆ provided, evidence ids, validateSummary, broker units). Ranking-stability eval = nightly; required before measured-mode default / GA. |
| Perf 1A | In-process broker memo TTL ~30–60s keyed by `(orgId, repoFullName, queryHash)` (or request-scoped ALS when co-located). |
| Docs | **REVIEW.md** is custom docs (not a new corpus). Broker docs bucket = REVIEW.md first + `gx-review-knowledge`. Index `review_policy` on push; GitHub Contents fallback. |

**Broker definition:** `retrieveReviewContext` in `server/src/context/broker.ts` — server-side retrieval façade only. Trusted `orgId` → namespaces; one embed + parallel tpuf queries; four buckets + manifest. Does not call the LLM or own Postgres payload loads.

**Also locked (no alternatives):**
- Prod: `withDefaultOrg` only when `localDevAuthEnabled()`; missing `X-Org-Id` must not invent an org.
- Fail-open per bucket; empty buckets recorded in manifest.
- Cloud API key leakage = full-tenant compromise; audit-log org access.

### Required test gaps (add to Phase 0–3 test lists)

- Membership lookup by `github_user_id` for both CLI and GitHub bearer paths; cloud key skip + audit.
- Prod missing `X-Org-Id` does not default-org; `localDev` never active in production env combo.
- `installation.created` → admin row; org member sync; personal install → sender only.
- Chunks: reject non-allowlisted `source_kind`, unknown repo, over-limit batch/rate.
- CLI route uses broker; `pr-payload` in validate/UI; zero-bucket hide.

## What already exists

- `searchIndex` / `loadReviewContext` — org/repo retrieval (extend, don't parallel forever)
- `IndexSnippetRow` + gx-mention citation ids — wire `indexSnippets`
- `searchCodeReviewHistory` — `source_kind` filter pattern for buckets
- `setIndexingFetch` — fake tpuf in tests
- `validate.ts` attribution parse — replace fallback; add clamp + `pr-payload`
- Console writers already stamp `org_id` on chunks; query filter does not use it yet (Phase 0.3)

## NOT in scope (explicit deferrals)

| Item | Why deferred |
|---|---|
| Per-user GitHub repo ACL within an org | Product is org-level today; revisit if enterprise asks |
| Per-org custom docs corpus | **Superseded:** repo-root `REVIEW.md` is the product mechanism (CLI already; console broker must respect it — Phase 1.1) |
| Attested one-shot migration of legacy `gx-sessions` | Prefer re-index via `/v1/index/chunks` + deterministic `chunk_hash` |
| Redis/shared broker cache | In-process TTL first; promote if metrics demand |
| Server-side GitHub Contents fetch for chunking (Arch 3C) | Allowlisted client chunks sufficient for v1 |
| Dual-identity membership graph | GitHub id is canonical (2A) |
| Ranking-stability as PR merge gate | Nightly until measured-mode / GA (Test 1A) |

## Remaining open questions (don't block Phase 0)

1. ~~Membership bootstrap~~ → **1A**
2. Within-org repo ACL — still open; default org-level.
3. ~~Per-org custom docs~~ → **`REVIEW.md` at repo root** (index + GitHub
   Contents fallback in broker docs bucket; global `gx-review-knowledge` remains
   the independent-resources corpus only).
4. Legacy `gx-sessions` — still open; default re-index (recommended).

## Parallelization

| Step | Modules | Depends on |
|---|---|---|
| Phase 0 auth + org_members | `server/src/middleware/`, `server/migrations/`, `server/src/github/` | — |
| Phase 0.3 tpuf org_id filter | `server/src/indexing/` | — (parallel with 0.1/0.2 once schema exists for tests) |
| Phase 1.1 broker | `server/src/context/` | Phase 0 merged |
| Phase 1.2 `/v1/index/chunks` | `server/src/routes/`, indexing | Phase 0 |
| gx CLI semantic → server | `~/git/gx` | `/v1/index/chunks` exists |
| Phase 2 wiring + 4A CLI | summary, review-plan, gx-mention, review/context | broker |
| Phase 3 attribution + UI | validate, prompts, `src/components/reviews/` | Phase 2 manifest |
| Phase 4 eval/nightly | `server/test/eval/` | Phase 3 |

```
Lane A: Phase 0 (auth → red-team) → deploy
Lane B (after A): broker + chunks endpoint
Lane C (parallel with B after chunks API): gx CLI index client
Lane D (after B): wire generators + CLI context + attribution/UI
Lane E (after D): nightly eval + staged rollout
```

Conflict flag: Lanes B and D both touch prompt/context loaders if started early — keep D after B merges.

## Failure modes

| Path | Failure | Test? | Handling | User sees |
|---|---|---|---|---|
| Spoofed `X-Org-Id` | Cross-tenant read | Red-team (required) | 403 | Error |
| Embed timeout in broker | All buckets empty | Broker unit | Fail-open + manifest 0s | Generation continues; attribution → `pr-payload` or hidden |
| Chunk poison / bad kind | Biased index | Allowlist tests | 400 | CLI error |
| Member sync lag | Legit user 403 | Webhook + invite tests | Admin invite / re-sync | 403 until synced |
| Broker flag off | No index context | Snapshot "all empty" | Legacy path | Today's behavior |
| Measured mode unstable | Ranking flip | Nightly eval | Don't default until green | N/A |

**Critical gaps closed by review:** identity key (2A), chunks trust (3A), spoof hole before broker (Phase 0 gate).

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 8 issues decided, 0 critical gaps open |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

- **UNRESOLVED:** 0 (all AskUserQuestion decisions answered)
- **VERDICT:** ENG CLEARED — ready to implement Phase 0; optional CEO (product/membership messaging) and Design (attribution UI) if you want them before Phase 3 UI.
