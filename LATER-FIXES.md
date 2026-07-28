# Later fixes

Known issues that are not blocking anything, with enough context to pick up
cold. Nothing here is breaking a deploy or a user-facing path today; each entry
says what it would cost to leave alone.

---

## `handleGxMention` times out locally but is green in CI

**Where:** `server/test/gx-mention.test.ts` —
`handleGxMention integration > retires matching rules on veto pattern`

**Symptom:** fails locally at *exactly* 5001ms, run after run. It has never
failed in CI: `deploy.yaml` has 12 consecutive green runs including all eight
from 2026-07-28.

**Why it is worth a look anyway:** the exact-5001ms figure is the interesting
part. Ordinary state pollution produces varied failures, and the rest of the
local flakiness does — the same suite gave 7 failures on one run and 1 on the
next from identical code, because `scripts/test-db.sh` reuses the database
across invocations while CI gets a fresh Postgres container per run. A constant
5001ms is a hardcoded timeout being hit, which points at something waiting on a
call that never resolves locally and is either mocked or fast in CI.

**Cost of leaving it:** a suite that fails differently on a developer's machine
than in CI trains people to ignore local failures. The `gx review` suite billing
OpenAI on every `go test` run went unnoticed for roughly that reason.

**Not** a deploy risk. The gate is green.

---

## `FILE_BATCH` may not be taking effect

**Where:** `convex/lib/turbopuffer/utils.ts` (`FILE_BATCH`), consumed by
`convex/lib/turbopuffer/runIndexRepo.ts`.

**Symptom:** `FILE_BATCH` was raised from 50 to 150 in #63, but a production
index of `satoricorp/console` immediately afterwards reported `offset=200` and
then `offset=400` — multiples of 50, not 150. Expected offsets at 150 would be
150, 300, then the 423-file tail.

**Two candidates**, not yet distinguished:

1. The run resumed against a plan built under the old batch size, so the offsets
   are historical and a fresh index would step by 150.
2. The constant is not reaching the loop, and batches are still 50.

**How to tell:** trigger an index of a repository with no prior plan and read
the offsets in `indexLog`.

**Cost of leaving it:** correctness is unaffected — the index completed at
423/423 files and 3536 chunks. Only the size of the win changes: the point of
#63 was collapsing per-file blob requests against an installation's 5000/hour
budget, and at batch 50 that is ~9 GitHub requests per index rather than ~3.
Both are enormously better than the 423 it replaced, so this is an optimisation
that did not fully land, not a regression.
