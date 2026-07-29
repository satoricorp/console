# Later fixes

Known issues that are not blocking anything, with enough context to pick up
cold. Nothing here is breaking a deploy or a user-facing path today; each entry
says what it would cost to leave alone.

---

## RESOLVED 2026-07-28 — `handleGxMention` times out locally but is green in CI

**Was:** `handleGxMention integration > retires matching rules on veto pattern`
(it lives in `server/test/rules.test.ts`, not the `gx-mention.test.ts` this
entry originally named) failed locally at exactly 5001ms while CI stayed green.

**Root cause:** the exact-5001ms figure was `bun test`'s default per-test
timeout (5s), not an application timeout. The test runs migrations plus a dozen
sequential DB round-trips and takes ~2s in isolation; under full-suite load on
a busy dev machine it crossed 5s and the runner killed it. CI's fresh container
never contends, so it never crossed.

**Fix:** the test declares a 20s timeout. The broader local-vs-CI flakiness had
a second, bigger cause, also fixed: two webhook tests armed
`OPENAI_API_KEY`/`TURBOPUFFER_API_KEY` and deleted them inline at the end of
the test body — cleanup that never runs when the test's own 50ms fire-and-
forget race fails first. The leaked key flipped `createLLMProvider` from the
mock provider onto the real-OpenAI path for every later summary test in the
process, cascading into unrelated 404/500 failures (observed: 35 → 6 → 4
failures across identical fresh-DB runs, load-dependent). The 50ms sleeps are
now bounded polls and the key cleanup is an unconditional `afterEach`.

---

## RESOLVED 2026-07-28 — `FILE_BATCH` may not be taking effect

**Was:** `FILE_BATCH` raised 50 → 150 in #63, but a production index of
`satoricorp/console` logged `offset=200` then `offset=400` — multiples of 50.

**Root cause analysis (static):** the constant does reach the loop —
`convex/lib/turbopuffer/runIndexRepo.ts` slices and advances by the live
`FILE_BATCH` import (`slice(offset, offset + FILE_BATCH)`, `nextOffset =
offset + FILE_BATCH`). The 50-multiples were checkpoints: `ensureIndexJob`
resumes from `filesIndexed`, which had been written by the previously deployed
bundle under batch 50, and Convex deploys are decoupled from git merges — #63
being on main did not mean #63 was the code running that index. A fresh index
under the current deploy steps by 150.

**Residual check (cheap):** trigger an index of a repository with no prior
plan and read `indexLog` offsets — expected 150, 300, then the tail.
