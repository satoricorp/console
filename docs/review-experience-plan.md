# Review Experience — `/reviews/{bookmarkId}` build plan

Status: design locked 2026-07-10 (v8). Scope: this repo only — the gx CLI needs no changes for v1 (its published artifact already carries patches, descriptions, agent provenance, self-reported intent, risk signals, and token counts).

## For the implementing model — read this first

- **This document + `docs/review-experience-mockup.html` are the complete spec.** The mockup is a standalone HTML file — open it in a browser to see the target design; its buttons at the top (dashed "mockup" strip) switch between the ready / analyzing / fallback states. Everything else you need is in this repo's code, referenced by path below.
- **The mockup file is the authoritative design source** for layout, spacing, type scale, color tokens, and markup structure. Port its CSS custom properties into the app's Tailwind v4 setup (`src/app/globals.css` uses `@theme inline`); build React components matching its DOM structure. Do NOT implement the dashed "mockup states" strip — it's mockup-only chrome. The mockup uses system font fallbacks; the real app already loads FK Display (`--font-fk-display`) and Geist Mono (`--font-geist-mono`) — use those vars.
- **Work the phases in order** (1 → 4). Each phase ends with a verification step — run it before moving on. Phase 5 is post-v1, skip unless asked.
- **Read the "Ground truth" section carefully before touching data.** It documents real hazards verified against production-shaped data: multi-GB payloads, columns that look right but are never populated, and a provider trap that silently gives you mock LLM output.
- Repo layout: `server/` = GX Cloud API (Bun + Hono + raw-SQL Postgres, port 3201, migrations in `server/migrations/`, runner `server/src/migrate.ts`); `src/` = Next.js 16 App Router + React 19 + Tailwind v4; `convex/` = Convex backend (Better Auth sessions, GitHub actions with the signed-in user's OAuth token). Package manager is Bun throughout.

## What we're building

A review page that shows ONLY the changes that need human review — pattern changes, high blast radius, architectural decisions — with a narrative (Summary + Why?), multi-source attribution, per-harness token/cost accounting, and a one-click **Approve & merge** that submits a GitHub approving review as the signed-in user, merges the PR, and records the decision.

The publish flow already returns `review_url = ${GX_SITE_URL}/reviews/${bookmarkId}` (`server/src/routes/publish.ts:765`); the route doesn't exist yet. This plan builds that destination.

## Ground truth (verified; shapes the implementation)

- `pr_events.payload` for a `gx.pr` event is the full `reviewbundle.Bundle` from the CLI: `stack[].patch`, `stack[].change.description`, `change.review_context.agent_provenance[] {session_id, agent_tool, provider, model_id, source}`, `risk {level, score, signals}`, `sessions[]` with `requests[] → responses[]`.
- **Payload size**: artifacts can be enormous (a real local one is 1.18 GB — sessions embed full LLM request/response bodies). Never `SELECT payload` wholesale; use jsonb path projections (`payload->'stack'`, `payload->'push'`, trimmed sessions projections) and compute plan/usage once, then persist.
- **Tokens**: the gx proxy token-extraction bug was fixed + backfilled on 2026-07-10 (root cause: codex SSE without `text/event-stream` content-type wiped extracted usage). Artifacts published after the fix carry per-response and session-rollup token counts. Older artifacts have NULL token fields but the raw `"usage"` JSON is inside `responses[].response_body` — the usage module needs a body-parse fallback for those.
- `session_events.tokens_in/out` in Postgres are never populated (`server/src/ingest/promote.ts` inserts no token columns) — read tokens from the artifact, not from `session_events`.
- `loadExtractContext` (`server/src/summary/generate.ts`) is nearly empty on the publish path; `hunk_links` attach to separate `/v1/extracts` events. Join them by `head_commit_id` as secondary attribution only.
- Intent sources in the artifact: agent SelfReport JSON (`agent_provenance[].source` where `agent_tool == "gx_commit"` — `{task_summary, commands_run, tests_run}`), revision descriptions, first user message per session, `demux_evidence[].intent`.
- **Provider trap**: the webhook summary path hardcodes `createMockProvider()` (`server/src/github/webhook.ts:300`). The review-plan generator must construct its own providers via `createReviewProviders()` (`server/src/llm/provider.ts:230`), best-of-N like `server/src/gx-mention/handler.ts:345-370`.
- `convex/lib/gxPrGithub.ts` has `mergePullRequestOnGithub` (line ~1030, handles draft→ready + retries) but no approving-review helper. `publishContextValidator` lives in `convex/lib/bookmarkActionContext.ts`. `loadAuthorizedBookmarkContext` throws for bookmark flows — pass `publishContext` built via `publishContextFromBookmark` (`src/lib/bookmark-action-context.ts`).
- `gxApiRequest` (`src/lib/gx-api-server.ts`) has no production consumers yet — the BFF routes here are the first. It injects `GX_CLOUD_API_KEY` + `X-User-Id`; the Hono server resolves the *default* org for such requests while publishes may attach an installation org, so review-endpoint access checks must include `bookmark.user_id = auth.userId`, not just org.
- Diff rendering precedent: `@pierre/diffs` `PatchDiff` in `src/app/r/[hash]/revision-view.tsx`.
- `decisions` insert precedent: `server/src/github/webhook.ts:674`. Nothing sets `bookmarks.merge_status='merged'` today — the decision endpoint will.

## Locked design (port `docs/review-experience-mockup.html` faithfully)

Layout: single centered column, max-width 860px. Order: review header → intro (Summary / Why? / attribution line, unboxed prose) → hairline divider → **Critical Review** cards → Activity → Safe to skim (collapsed) → Agent usage (collapsed accordion) → sticky approve bar. Nothing above Critical Review sits in a container — boxes begin at the cards.

- **Site header**: `gx` mark + breadcrumb `org / repo / bm_id` (mono, bookmark id emphasized). No PR button — the PR URL lives in the meta line.
- **Review header**: balanced ~24px title first, then ONE wrapping mono meta line (12px, `·`-separated): colored status dot + `open|merged`, colored risk dot + `{level} risk` (no numeric score), `N files`, `N revisions`, `branch → base`, head sha link, `2h ago by {user}`, `PR #N ↗`. No chip pills.
- **Intro** (unboxed): **Summary** and **Why?** are collapsed `<details>` accordions, stacked tightly (~6px apart). The collapsed trigger is TWO stacked lines: caret + prominent title (~16.5px / 650 weight sans, NOT a small-caps label — must read as important sections; tints accent-blue on hover) on the first line, and the one-sentence teaser (muted 14px, ending in `…`, single line with CSS ellipsis, left-aligned under the title) as the next line. Expanding hides the teaser and shows the full text bodies in its place. Expanded body = full prose (purpose + original intent for Summary, ≤ ~450 chars, with the agent self-report quoted in a violet-left-bordered mono block; rationale for Why?, same length). The teaser is the first sentence of / a one-sentence condensation of the full text — the plan generator should emit `narrative.summaryTeaser` and `narrative.whyTeaser` fields alongside the full texts. Below the accordions, a single **attribution line**: label + 180px stacked bar + inline legend `agent sessions 58% · codebase 22% · previous PRs 12% · independent docs 8%` (violet/blue/teal/gray). A hairline `<hr>` separates the intro from Critical Review.
- **Critical Review** (19px semibold header, `N of M` in small gray mono): 3–7 ranked cards. Each: neutral rank square; title; outlined category pill with colored dot (`architecture` blue / `pattern` violet / `blast radius` red); revision id link (`r/xxxxxx`); why-it-matters paragraph (~2-3 sentences); anchor line = file path + `L{start}–{end} ↗` linking to `https://github.com/{repo}/blob/{headSha}/{file}#L{start}-L{end}`; attribution chip (`agent · {harness} · {model}` violet-tinted, or `human · {name}` gray); diff excerpt (mono table, line numbers, green/red washes, blue inset bar on key lines when `anchorConfidence === "exact"`); footer: `+adds −dels`, "full file diff", "session transcript ↗".
- **Activity**: simple bordered list — push, plan generated (model), summary posted, CI events. Timestamps in small mono.
- **Safe to skim**: `<details>` accordion; each row = GitHub-linked file path + one-line reason.
- **Agent usage**: `<details>` accordion at the bottom; the always-visible summary row shows `{X} MTok · est. ${Y}` (+ `+N unpriced` when applicable). Expanded: one row per harness×model — sessions, in/out tokens, `% cached`, cost (— for unpriced) — with a thin violet cache bar; footnote "Estimated from captured token counts and public list prices" and unpriced-model warnings.
- **Approve bar**: fixed bottom, blurred bg. Left: stacked CI status (`✓ CI passing 14/14 checks`) over a small note ("Approves PR #N as you on GitHub, then merges. Your decision is recorded to the review ledger" — hidden < 700px). Right: inline button group `[Open in GitHub] [Approve & merge]` — never wraps apart. Approve button is the inverted primary (black-on-light / white-on-dark).
- **Palette** (Vercel-flavored, both themes; tokens in mockup source): grounds `#ffffff` / `#0a0a0a`; lines `#eaeaea` / `#262626`; accent blue `#0070f3` / `#52a8ff` (links, anchors, diff highlight); agent violet `#7928ca` / `#bf7af0` (attribution chips/bars/quote); diff add `#1a7f37` / `#7ee2a8`, del `#cb2a2f` / `#ff6166` on subtle washes; semantic ok/warn/risk distinct from accent. Type: FK Display (sans) + Geist Mono; tabular-nums on all numeric columns.
- **States**: *analyzing* (spinner hero + shimmer skeletons; poll every ~4s), *fallback* (warning notice + latest summary text + full diffs) when plan generation failed or artifact missing.

## Phase 1 — pricing, usage, read API (`server/`)

New files:
- `server/src/pricing/model-pricing.ts` — static rules `{family, match: RegExp, pricing: {input, output, cacheRead, cacheWrite}}` USD/1M tokens (claude opus/sonnet/haiku, gpt-5.x, o-series, gemini). `pricingForModel(modelId)` normalizes (lowercase; strip `us.anthropic.`, `bedrock:`, date/version suffixes); unmatched → null.
- `server/src/review-plan/usage.ts` — builds `UsageBreakdown {totals, byHarness[], bySession[], unknownModels[]}` from the artifact sessions: harness from `agent_provenance` session map (skip `gx_commit` pseudo-sessions) with `command`/`process_name` heuristic fallback (harness is a plain string — no enum); tokens from per-response columns, session rollups, or (older artifacts) parsing `"usage"` JSON out of `response_body`.
- `server/migrations/022_review_plans.sql`:
  ```sql
  CREATE TABLE review_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id),
    bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    event_id UUID REFERENCES pr_events(id) ON DELETE SET NULL,
    head_commit_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
    plan JSONB, usage JSONB, model TEXT, provider TEXT, error TEXT,
    latency_ms BIGINT, created_at_ms BIGINT NOT NULL, updated_at_ms BIGINT NOT NULL,
    UNIQUE (bookmark_id, head_commit_id)
  );
  ```
- `server/src/routes/reviews.ts` (mount in `server/src/app.ts`):
  - `GET /v1/reviews/:bookmarkId` → `ReviewResponse {bookmark, plan {status: ready|pending|failed|missing, stale, plan, model, generatedAtMs}, usage, changes[] (changeId, title, description, files, patch — from stack[]), notablePatches (per-file slices for plan anchors), summary (latest summaries row), activity[] (derive from pr_events / summaries / review_plans / decisions timestamps), publishContext (repoFullName, headBranch, baseBranch, pullRequestNumber)}`. Auto-enqueue generation when plan missing but artifact exists. Access: `bookmark.user_id = auth.userId OR bookmark.org_id = auth.orgId`.
  - `POST /v1/reviews/:bookmarkId/plan {force?}` — regenerate.
  - `POST /v1/reviews/:bookmarkId/decision {action:'approve', merged, mergeSha?, prNumber?, reason?}` — insert `decisions` row; on `merged:true`, `UPDATE bookmarks SET merge_status='merged', merged_at_ms=...`.

Verify: unit tests for pricing fuzzy-match + usage aggregation against a captured artifact fixture (copy a small real artifact from `~/.gx/reviews/` — e.g. one of the ~50–200 KB files — into a test fixture, stripping `requests[].request_body`/`responses[].response_body` except one response body kept to exercise the usage-JSON body-parse fallback); `curl -H "Authorization: Bearer $GX_CLOUD_API_KEY" -H "X-User-Id: <user>" localhost:3201/v1/reviews/<bookmarkId>` against real local `pr_events` rows.

## Phase 2 — review-plan generation (`server/`)

New `server/src/review-plan/`: `types.ts`, `context.ts`, `patch.ts` (~60-line unified-diff splitter — do not pull @pierre/diffs into Bun), `validate.ts`, `generate.ts`; prompt in `server/src/llm/prompts/review-plan.ts`. Trigger: fire-and-forget after `postMissingPrSummaryAfterPublish` in `server/src/routes/publish.ts` (same try/catch pattern, ~lines 152-164).

`ReviewPlan` (stored in `review_plans.plan`; patch excerpts NOT stored — sliced at read time):
```ts
{ schemaVersion: 1,
  narrative: { summary, summaryTeaser, why, whyTeaser, attributionSources: [{source: "agent-sessions"|"codebase"|"previous-prs"|"docs", pct}], selfReportQuote? },
  notableChanges: [{ rank, category: "architecture"|"pattern"|"blast-radius"|"other", title, whyItMatters,
    anchor: {file, lineStart?, lineEnd?, revisionChangeId?}, anchorConfidence: "exact"|"file"|"unverified",
    attribution?: {authorship, tool?, model?} }],
  safeToSkim: [{ file, reason }],
  revisions: [{ changeId, branchName?, title }] }
```
- Context: revisions + per-file patches (cap ~300 lines/file, ~6k total; drop lockfiles/generated) + risk/changed-symbols/structural-deps; intent block (self-report JSON, first user messages ≤1k chars each, demux intents, descriptions); attribution from `agent_provenance` + `hunk_links` join by `head_commit_id`.
- Prompt: principal-engineer system prompt, JSON-only, 3–7 notable changes in the three categories, every other file to `safeToSkim` with a reason, anchors must be changed files with new-file line numbers inside shown hunks, narrative fields ≤600 chars, teasers exactly one sentence, summary must restate original intent quoting self-report/first prompt.
- `attributionSources` percentages are the model's estimate of where the narrative's evidence came from (agent sessions vs. codebase vs. previous PRs vs. docs), based on the context blocks provided in the prompt — label them as estimates in the UI tooltip; they are informative, not measured.
- Providers: `createReviewProviders()` best-of-N; score = valid JSON + anchor-validation rate + category coverage; store winner's provider/model (`model='mock'` gets a UI badge).
- Validation: drop changes anchored to unknown files; line ranges must intersect patch hunk new-line ranges else downgrade to `"file"`; <1 surviving change → `status='failed'` (UI falls back).
- Idempotency: `ON CONFLICT (bookmark_id, head_commit_id)` re-run only when failed or forced; GET serves row matching `bookmarks.head_commit_id` else newest + `stale:true`.

Verify: force-generate against 2–3 real local bookmarks (incl. one stack) with mock provider, then a real key; assert anchors validate; re-POST idempotent.

## Phase 3 — console page (`src/`)

- `convex/profile.ts`: add `getViewer` query via `authComponent.safeGetAuthUser` (pattern at profile.ts:44).
- BFF: `src/app/api/reviews/[bookmarkId]/route.ts` (GET), `.../plan/route.ts`, `.../decision/route.ts` — `fetchAuthQuery(api.profile.getViewer)` (401 if null) → `gxApiRequest(viewer.id, ...)`.
- `src/lib/reviews-client.ts` — fetchers + mirrored TS types.
- Page: `src/app/reviews/[bookmarkId]/page.tsx` (server component) + `review-view.tsx` (client; polls ~4s while pending). Components in `src/components/reviews/`: `review-header`, `narrative-section` (Summary/Why? + attribution bar), `critical-review-card`, `activity-panel`, `safe-to-skim`, `usage-accordion`, `approve-merge-bar`, `plan-pending`. Diffs via `PatchDiff` (`revision-view.tsx:84` pattern) fed from `notablePatches`; group cards by revision when `stack.length > 1`.
- CI status: `useAction(api.gxPrActions.getPublishStatus)` with `publishContext` + `includeCiChecks: true`; disable merge until checks pass (confirm-override when no checks).

Verify: sign in locally, open a real bookmark; pending→ready transition; diffs, attribution bar, usage accordion totals against fixture; 404/fallback states; light + dark.

## Phase 4 — approve + merge

- `convex/lib/gxPrGithub.ts`: `submitApprovingReview(token, repoFullName, pullNumber, body?)` → `POST /repos/:owner/:repo/pulls/:n/reviews {event:"APPROVE"}`; map 422 "Can not approve your own pull request" → `{approved:false, reason:"self_approval"}`.
- `convex/gxPrActions.ts`: `approveAndMergePullRequest({bookmarkId, publishContext, pullRequestNumber?, approvalBody?})`: auth → resolve PR → already-merged short-circuit → `submitApprovingReview` (self-approval ⇒ merge-only + notice) → existing `mergePullRequestOnGithub` (branch-protection errors surface verbatim).
- `approve-merge-bar`: run action → `POST /api/reviews/:id/decision`. Error states: approval-ok-merge-failed → record approve-only + retry-merge; already-merged → record + refresh header.

Verify: sandbox repo with required-approvals protection — second-account PR approves+merges; own PR gets self-approval notice + merge; failing CI blocked; `decisions` row + `merge_status='merged'` in Postgres.

## Phase 5 — polish (post-v1)

Stale-plan regen on new push; PostHog events (plan generated/viewed/decision); payload-size guards; optional metering (`checkPrSummaryQuota` pattern); GitHub summary comment deep-links to `/reviews/{id}`; opencode capture (gx repo, separate task).
