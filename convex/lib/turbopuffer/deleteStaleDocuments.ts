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
