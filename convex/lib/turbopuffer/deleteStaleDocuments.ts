"use node";

import { getNamespace, CODE_FILE_SOURCE_KIND } from "./turbopufferClient";
import { withRetry } from "./retry";

/**
 * Removes this repository's indexed source from generations other than the one
 * just written, so retrieval stops answering with files that no longer exist.
 *
 * The `source_kind` half of the filter is not optional. This namespace is
 * shared: the gx Cloud server writes `push_delta` and `hunk_link` rows into it
 * on every push, and the gx CLI writes session transcripts and review policy.
 * None of those carry the commit id of an index run, so a sweep on
 * `commit_id NotEq` alone — which is what this did while the namespace was
 * private to this indexer — would delete every one of them on each merge, and
 * they would not return until whatever wrote them happened to run again.
 *
 * Scoping to code_file also keeps the sweep correct for its own rows: a full
 * pass rewrites every current chunk with the new commit id, so anything left
 * carrying an older one is genuinely gone from the repository.
 *
 * FULL PASSES ONLY. An incremental pass leaves unchanged files untouched, and
 * untouched rows keep the commit id they were written with — this filter would
 * delete the entire repository except the handful of files that happened to
 * change. Incremental passes retire rows by id instead; see deleteDocumentIds.
 */
export async function deleteStaleDocuments(
  orgId: string,
  fullName: string,
  commitId: string,
) {
  const ns = getNamespace(orgId, fullName);

  try {
    await withRetry(
      () =>
        ns.write({
          delete_by_filter: [
            "And",
            [
              ["source_kind", "Eq", CODE_FILE_SOURCE_KIND],
              ["commit_id", "NotEq", commitId],
            ],
          ],
        }),
      { maxAttempts: 4, baseMs: 1000 },
    );
  } catch (error) {
    console.warn(`delete_by_filter failed for ${fullName}, continuing:`, error);
  }
}

/**
 * How many code chunks this repository actually has in the namespace.
 *
 * A full pass could report its own write count as the index size, because it
 * wrote every row. An incremental pass writes a handful, so the console would
 * show "2 files, 8 chunks" for a repository holding thousands. Counting is the
 * only exact answer, and it is cheap: TurboPuffer bills queried bytes at $1/PB
 * against a per-query floor, so one count per completed pass rounds to nothing.
 *
 * Returns null when the count fails. Reporting a stale size beats failing a pass
 * that has already done its work.
 */
export async function countIndexedChunks(
  orgId: string,
  fullName: string,
): Promise<number | null> {
  try {
    const ns = getNamespace(orgId, fullName);
    const result = await withRetry(
      () =>
        ns.query({
          filters: ["source_kind", "Eq", CODE_FILE_SOURCE_KIND],
          aggregate_by: { chunks: ["Count", "id"] },
        }),
      { maxAttempts: 3, baseMs: 500 },
    );
    const count = (result as { aggregations?: { chunks?: unknown } })?.aggregations?.chunks;
    return typeof count === "number" ? count : null;
  } catch (error) {
    console.warn(`chunk count failed for ${fullName}, keeping previous:`, error);
    return null;
  }
}

/** Ids per delete request. Matches the upsert batch size for the same reason. */
const DELETE_BATCH = 100;

/**
 * Retire specific rows by id — the incremental pass's answer to the stale sweep.
 *
 * Ids are computed, not looked up: documentId is a pure function of (repo, path,
 * chunk index), so a deleted file's rows can be named without first asking what
 * is there. Deleting an id that does not exist is a no-op in TurboPuffer, which
 * is what makes naming a file's whole chunk range safe.
 */
export async function deleteDocumentIds(
  orgId: string,
  fullName: string,
  ids: string[],
) {
  if (ids.length === 0) return;

  const ns = getNamespace(orgId, fullName);
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH);
    try {
      await withRetry(() => ns.write({ deletes: batch }), {
        maxAttempts: 4,
        baseMs: 1000,
      });
    } catch (error) {
      // Same posture as the sweep: a failed delete leaves a stale row, which
      // degrades retrieval. Failing the run instead would leave the repository
      // unindexed, which is worse.
      console.warn(`deletes failed for ${fullName}, continuing:`, error);
    }
  }
}
