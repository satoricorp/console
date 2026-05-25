"use node";

import { getNamespace } from "./turbopufferClient";
import { withRetry } from "./retry";

export async function deleteStaleDocuments(
  fullName: string,
  commitId: string,
) {
  const ns = getNamespace(fullName);

  try {
    await withRetry(
      () =>
        ns.write({
          delete_by_filter: ["commit_id", "NotEq", commitId],
        }),
      { maxAttempts: 4, baseMs: 1000 },
    );
  } catch (error) {
    console.warn(`delete_by_filter failed for ${fullName}, continuing:`, error);
  }
}
