"use node";

import {
  getNamespace,
  TURBOPUFFER_SCHEMA,
  type IndexedDocument,
} from "./turbopufferClient";
import { withRetry } from "./retry";

const UPSERT_BATCH = 100;

export async function upsertDocuments(
  orgId: string,
  fullName: string,
  documents: IndexedDocument[],
) {
  if (documents.length === 0) return;

  const ns = getNamespace(orgId, fullName);

  for (let i = 0; i < documents.length; i += UPSERT_BATCH) {
    const batch = documents.slice(i, i + UPSERT_BATCH);
    await withRetry(
      () =>
        ns.write({
          upsert_rows: batch,
          distance_metric: "cosine_distance",
          schema: TURBOPUFFER_SCHEMA,
        }),
      { maxAttempts: 4, baseMs: 1000 },
    );
  }
}
