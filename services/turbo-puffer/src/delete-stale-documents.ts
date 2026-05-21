import { getNamespace } from "./turbopuffer-client";

export async function deleteStaleDocuments(
  fullName: string,
  commitId: string,
) {
  const ns = getNamespace(fullName);

  try {
    await ns.write({
      delete_by_filter: ["commit_id", "NotEq", commitId],
    });
  } catch (error) {
    console.warn(`delete_by_filter failed for ${fullName}, continuing:`, error);
  }
}
