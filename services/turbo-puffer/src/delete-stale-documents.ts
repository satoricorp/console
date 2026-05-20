import { getNamespace } from "./turbopuffer-client";

export async function deleteStaleDocuments(
  fullName: string,
  commitId: string,
) {
  const ns = getNamespace(fullName);
  let remaining = true;

  while (remaining) {
    const result = await ns.write({
      delete_by_filter: ["commit_id", "NotEq", commitId],
      delete_by_filter_allow_partial: true,
    });

    remaining = Boolean(
      (result as { rows_remaining?: boolean }).rows_remaining,
    );
  }
}
