import { describe, expect, mock, test } from "bun:test";

/**
 * The stale sweep is the one write in the indexer that can destroy data it did
 * not create.
 *
 * `gx-{orgId}-{repo}-v2` is shared: the GX Cloud server writes `push_delta` and
 * `hunk_link` rows into it on every push, and the gx CLI writes session
 * transcripts and review policy. None of those carry the commit id of an index
 * run. The sweep used to delete on `commit_id NotEq` alone, which was correct
 * only while the namespace was private to this indexer — pointed at the shared
 * one it would have deleted every other writer's rows on every merge, silently,
 * with no error and nothing to notice until a review came back thin.
 *
 * These tests pin the filter shape rather than the behaviour of TurboPuffer,
 * because the filter is the whole of the correctness here.
 */

type Write = { delete_by_filter?: unknown };

async function captureSweepWrite(commitId: string): Promise<Write> {
  const writes: Write[] = [];
  mock.module("../convex/lib/turbopuffer/turbopufferClient", () => ({
    CODE_FILE_SOURCE_KIND: "code_file",
    getNamespace: () => ({
      write: async (body: Write) => {
        writes.push(body);
        return {};
      },
    }),
  }));

  const { deleteStaleDocuments } = await import(
    "../convex/lib/turbopuffer/deleteStaleDocuments"
  );
  await deleteStaleDocuments("org-1", "acme/api", commitId);

  expect(writes).toHaveLength(1);
  return writes[0]!;
}

function flatten(filter: unknown): string[] {
  if (!Array.isArray(filter)) return typeof filter === "string" ? [filter] : [];
  return filter.flatMap(flatten);
}

describe("stale index sweep", () => {
  test("deletes only code_file rows, and only from other commits", async () => {
    const write = await captureSweepWrite("commit-b");
    const tokens = flatten(write.delete_by_filter);

    // Both halves must be present. Either one alone is a bug with no symptom:
    // without source_kind it deletes other writers' rows, without commit_id it
    // deletes the index it just wrote.
    expect(tokens).toContain("source_kind");
    expect(tokens).toContain("code_file");
    expect(tokens).toContain("commit_id");
    expect(tokens).toContain("commit-b");
    expect(tokens).toContain("And");
  });

  test("does not sweep on commit_id alone", async () => {
    const write = await captureSweepWrite("commit-b");

    // The exact shape the sweep had before the namespace was shared. If the
    // filter ever collapses back to this, every push_delta, hunk_link, session
    // transcript and review policy row in the namespace goes with the next
    // merge.
    expect(write.delete_by_filter).not.toEqual(["commit_id", "NotEq", "commit-b"]);
  });
});
