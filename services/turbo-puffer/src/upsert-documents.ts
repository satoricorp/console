import {
  getNamespace,
  TURBOPUFFER_SCHEMA,
  type IndexedDocument,
} from "./turbopuffer-client";

const UPSERT_BATCH = 100;

export async function upsertDocuments(
  fullName: string,
  documents: IndexedDocument[],
) {
  if (documents.length === 0) return;

  const ns = getNamespace(fullName);

  for (let i = 0; i < documents.length; i += UPSERT_BATCH) {
    const batch = documents.slice(i, i + UPSERT_BATCH);
    await ns.write({
      upsert_rows: batch,
      distance_metric: "cosine_distance",
      schema: TURBOPUFFER_SCHEMA,
    });
  }
}
