# Testing plan: Full-source review context + attribution

Companion to [`PLAN-review-context-attribution.md`](./PLAN-review-context-attribution.md).

**Goal:** Prove (1) no cross-org reads, (2) generators only cite evidence the broker
actually provided, (3) `REVIEW.md` and the four buckets work behind
`GX_CONTEXT_BROKER=1`, (4) kill switch restores legacy behavior.

**Gates:** Phase 0 must be green in staging before enabling the broker in prod.
PR merge gate = deterministic checks only; ranking-stability eval is nightly.

---

## 0. Already covered (regression baseline)

Run before every merge touching this work:

```bash
cd server && bun test test/auth-middleware.test.ts test/context-broker.test.ts test/review-plan.test.ts
cd server && bun run typecheck
```

| Area | File | Status |
|---|---|---|
| Cloud key / CLI / GitHub auth + spoof 403 | `server/test/auth-middleware.test.ts` | Exists |
| Broker flag-off, bucket routing, memo | `server/test/context-broker.test.ts` | Exists |
| Plan validate / usage / patches | `server/test/review-plan.test.ts` | Exists (extend for `pr-payload`) |

---

## 1. Phase 0 — Tenant isolation (ship blocker)

### 1.1 Unit / middleware

| # | Case | Expect | Where |
|---|---|---|---|
| A1 | Cloud API key + `X-Org-Id` | 200; membership skipped; audit log | auth-middleware ✓ |
| A2 | Cloud API key, no `X-Org-Id` | 200 with default org fill-in (Console BFF path) | auth-middleware ✓ |
| A3 | CLI `gxcs_` + member `github_user_id` | 200 | auth-middleware ✓ |
| A4 | CLI + spoofed other org | 403 | auth-middleware ✓ |
| A5 | GitHub token + member | 200 + `githubUserId` | auth-middleware ✓ |
| A6 | GitHub token + non-member | 403 | auth-middleware ✓ |
| A7 | CLI / GitHub without `github_user_id` | 403 | **Add** |
| A8 | `NODE_ENV=production`, no cloud key, no token | 401; never `local-dev` | auth-middleware ✓ |
| A9 | Prod + empty org after resolve | 401 (no `withDefaultOrg`) | **Add** assert |

### 1.2 DB integration (`DATABASE_URL` required)

| # | Case | Expect |
|---|---|---|
| M1 | Apply `024_org_members.sql` | Table + PK `(org_id, github_user_id)` |
| M2 | `installation.created` with sender id | Row `role=admin`, `source=github_install` |
| M3 | Org account install | Sync upserts `source=github_sync` members (mock GitHub Members API) |
| M4 | Personal install | Sender only; no members list call failure |
| M5 | Seed orgs A/B + members; A-token + `X-Org-Id=B` | 403 on `/v1/review/context`, summary, plan, mention |
| M6 | Same as M5 with fake tpuf | **Zero** requests to B’s namespace |

### 1.3 Query-shape / indexing

| # | Case | Expect |
|---|---|---|
| Q1 | `searchIndex` body | `filters` includes `And` + `org_id Eq` + `repo_full_name Eq` |
| Q2 | Knowledge namespace query | `source_kind Eq review_corpus`; no tenant `org_id` required |

Extend `server/test/indexing.test.ts` or broker test to assert Q1 on captured bodies.

### 1.4 Red-team matrix (CI + staging)

Matrix: `{cloud key, gxcs_, GitHub token, no token}` × `{own org, other org, garbage uuid, missing header}` × routes:

- `GET /v1/review/context`
- `POST /v1/summaries/generate` (or whatever summary route)
- review-plan generate path
- gx-mention handler path
- `POST /v1/index/chunks`

**Pass criteria:** every “other/garbage” cell is 401/403; own-org member cells 200 (or business 4xx, never other-tenant data); cloud key without org = 401.

Check in `server/test/security/org-isolation-matrix.test.ts` (new). Paste the table into the Phase 0 PR description after CI + staging runs.

### 1.5 Phase 0 acceptance

- [ ] Matrix green in CI
- [ ] Second engineer reviews auth diff
- [ ] Staging matrix green against real Postgres (+ fake or real tpuf)
- [ ] Backfill script dry-run reviewed; prod backfill completed before hard 403 cutover

---

## 2. Phase 1 — Broker + REVIEW.md + `/v1/index/chunks`

### 2.1 Broker unit

| # | Case | Expect | Status |
|---|---|---|---|
| B1 | `GX_CONTEXT_BROKER` unset | Empty buckets/manifest | ✓ |
| B2 | Flag on + seeded kinds | Buckets by `source_kind`; citation ids `A/C/P/D` | ✓ partial |
| B3 | Per-bucket failure | That bucket `provided: 0`; others OK | **Add** |
| B4 | Char / top-k caps | Enforced | **Add** |
| B5 | Memo TTL | Second identical call does not re-embed main query | ✓ |
| B6 | `REVIEW.md` via Contents | Appears first in docs as `D1`, `file=REVIEW.md` | **Add** (mock fetch) |
| B7 | No REVIEW.md; policy chunks only | Docs from `review_policy` index | **Add** |
| B8 | Corpus only | Docs from knowledge ns; filter `review_corpus` | **Add** |
| B9 | Codebase without `code_file` | Manifest label `codebase (history only)` | **Add** |

### 2.2 `/v1/index/chunks`

| # | Case | Expect |
|---|---|---|
| C1 | Member + allowlisted kind + installed repo | 200; upsert; client `org_id` overwritten |
| C2 | `source_kind=code_review_summary` | 400 |
| C3 | Repo not on installation | 400 |
| C4 | >64 chunks or oversize text | 400 |
| C5 | Idempotent `chunk_hash` | Second upsert same hash OK |
| C6 | Non-member / spoof org | 403 |

New file: `server/test/index-chunks.test.ts` (DB + `setIndexingFetch`).

### 2.3 Phase 1 acceptance

- [ ] Fixture repo with all four `source_kind`s → non-empty buckets
- [ ] Broker p95 ≤ 1.5s against fake store (parallel queries)
- [ ] Cross-tenant: org A broker never queries org B namespace

---

## 3. Phase 2 — Wire into generators

### 3.1 Prompt / snapshot

| # | Case | Expect |
|---|---|---|
| P1 | All buckets present | Prompt has manifest line + bucket sections |
| P2 | Some buckets empty | Only non-empty sections; no claim of empty buckets |
| P3 | Flag off / indexing null | Degrades to pre-broker prompts (no crash) |
| P4 | Summary prompt | Includes indexed snippets when attached |
| P5 | Review plan prompt | `Context provided: …` + REVIEW.md before corpus |

Prefer snapshot tests under `server/test/` for `buildPRSummaryUserPrompt` /
`buildReviewPlanUserPrompt`.

### 3.2 End-to-end (mock LLM + fake tpuf + Postgres)

| # | Case | Expect |
|---|---|---|
| E1 | Generate summary | Prompt contained broker sections when flag on |
| E2 | Generate review plan | Same + validate succeeds |
| E3 | `@gx` mention | Indexed section ≠ `(none)` when snippets present |
| E4 | `GET /v1/review/context` | `indexSnippets` from broker when flag on |
| E5 | Latency | Summary+plan p95 +≤2s vs baseline with broker; broker overlaps Postgres load |

### 3.3 Phase 2 acceptance

- [ ] Flag off regression suite green
- [ ] Flag on E1–E4 green
- [ ] No cross-org data in any generator prompt (assert namespaces in fake tpuf log)

---

## 4. Phase 3 — Honest attribution + UI

### 4.1 `validate.ts`

| # | Case | Expect |
|---|---|---|
| V1 | Model claims `docs` with `provided: 0` | Zeroed / dropped; renormalized |
| V2 | Empty model attribution | Fallback from manifest + `pr-payload` (not 70/20/5/5) |
| V3 | Only payload, empty index | `[{ source: "pr-payload", pct: 100 }]` |
| V4 | Unknown `evidence` ids | Stripped |
| V5 | `pr-payload` when `prPayloadPresent=false` | Dropped |

Add cases to `server/test/review-plan.test.ts`.

### 4.2 UI / fixture

| # | Case | Expect | Surface |
|---|---|---|---|
| U1 | Zero-pct sources hidden | Not in bar/legend | `narrative-section` |
| U2 | `pr-payload` styled | Label “PR payload” | same |
| U3 | Estimated tooltip | “not measured” | same |
| U4 | Measured tooltip (when field set) | “Measured from cited evidence” | same |
| U5 | Demo fixture still renders | `demo-review.ts` | manual / smoke |

### 4.3 GitHub comment

| # | Case | Expect |
|---|---|---|
| G1 | Provenance footer | `Sources: …` counts from **manifest**, not model |

---

## 5. Phase 4 — Eval + rollout

### 5.1 Deterministic PR gate (blocks merge)

On PRs touching `llm/prompts/`, `review-plan/`, `summary/`, `context/`:

1. Schema-valid plan  
2. `attributionSources ⊆ provided buckets ∪ {pr-payload}`  
3. Evidence ids resolve  
4. Summary passes `validateSummary`  
5. Broker + auth unit suites above  

### 5.2 Nightly ranking eval (does not block every PR)

- 10–15 fixtures (agent-heavy, human-heavy, docs/REVIEW.md, rich history, empty index)
- 3× regenerate; **bucket ranking** stable (pct may wobble)
- Required green for N days before measured-mode default or GA

### 5.3 Rollout checklist

| Stage | Checks |
|---|---|
| Dev | Unit + mock provider + fake tpuf |
| Staging | Red-team matrix + real tpuf; spot-check 5 plans |
| Prod internal (`GX_CONTEXT_BROKER=1`) | ≥1 week: `AttributionClamped` → ~0, broker p95, 10 hand reviews |
| GA | Kill switch verified (unset flag → legacy) |

---

## 6. Manual QA script (staging)

Use an org you belong to and a second org you do not.

1. **Isolation:** CLI/session with `X-Org-Id=<other>` → 403 on context + chunks.  
2. **Install:** Fresh GitHub App install → you appear in `org_members` as admin.  
3. **REVIEW.md:** Repo with root `REVIEW.md` → review plan prompt / docs bucket cites it (`D1`).  
4. **No REVIEW.md:** Docs may still show corpus; attribution must not invent REVIEW.md.  
5. **Broker on:** Generate plan + summary; attribution bar has no 0% slices; Sources footer matches index counts.  
6. **Broker off:** Unset flag; regenerate; no crash; indexed sections empty/legacy.  
7. **Chunks:** `POST /v1/index/chunks` with `code_file` for an installed repo → later broker codebase hits improve. Reject `code_review_summary`.  
8. **@gx:** Comment on PR with index seeded → reply cites indexed context (not `(none)`).

---

## 7. Suggested implementation order for missing tests

1. `review-plan.test.ts` — V1–V5 (`pr-payload` / clamp) — fast, no DB  
2. `index-chunks.test.ts` — C1–C6  
3. `security/org-isolation-matrix.test.ts` — 1.4  
4. Prompt snapshots — P1–P5  
5. Webhook membership — M2–M4  
6. Broker REVIEW.md / fail-open — B3–B9  
7. Nightly eval harness — 5.2  

---

## 8. Out of scope for this plan

- gx CLI repo change (client writing `/v1/index/chunks`) — separate test plan in `~/git/gx`
- Per-user GitHub repo ACLs within an org
- Measured attribution as default (until nightly green)
