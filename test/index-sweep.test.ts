import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  codeRowIdRange,
  documentId,
  MAX_CHUNKS_PER_FILE,
} from "../convex/lib/turbopuffer/utils";

/**
 * Deleting is the one thing this indexer does that can destroy data it did not
 * create, and both of its delete paths fail silently when they are wrong.
 *
 * The sweep: `gx-{orgId}-{repo}-v2` is shared. The gx Cloud server writes
 * `push_delta` and `hunk_link` rows into it on every push, and the gx CLI writes
 * session transcripts and review policy. None of those carry the commit id of an
 * index run, so a sweep on `commit_id NotEq` alone — correct only while the
 * namespace was private to this indexer — would delete every other writer's rows
 * on every merge, with no error and nothing to notice until a review came back
 * thin.
 *
 * The incremental pass: a merge used to rewrite the whole repository, because
 * the commit id was part of every row's id. Now unchanged files are left alone,
 * which means most rows keep the *previous* commit id — so running that same
 * sweep after an incremental pass deletes the entire index except the handful of
 * files that happened to change. Also silent, also total.
 *
 * These tests drive the real delete code against a recording namespace, because
 * the filter and the id arithmetic are the whole of the correctness here.
 */

type Write = {
  delete_by_filter?: unknown;
  deletes?: string[];
  upsert_rows?: Array<{ id: string }>;
};

const writes: Write[] = [];

// Only the TurboPuffer client is faked. deleteStaleDocuments, deleteDocumentIds
// and upsertDocuments all run for real and land here, so what these tests assert
// is what production sends.
mock.module("../convex/lib/turbopuffer/turbopufferClient", () => ({
  CODE_FILE_SOURCE_KIND: "code_file",
  TURBOPUFFER_SCHEMA: {},
  getNamespace: () => ({
    write: async (body: Write) => {
      writes.push(body);
      return {};
    },
    query: async () => ({ aggregations: { chunks: 4242 } }),
  }),
}));

const TREE = [
  { path: "src/a.ts", sha: "sha-a", type: "blob" as const, mode: "100644", size: 100 },
  { path: "src/b.ts", sha: "sha-b", type: "blob" as const, mode: "100644", size: 100 },
  { path: "src/c.ts", sha: "sha-c", type: "blob" as const, mode: "100644", size: 100 },
];

let treeTruncated = false;
let compareResult: unknown = { usable: false, reason: "not configured" };
let fileContents: Record<string, string> = {};

function source(name: string, lines = 4): string {
  return Array.from({ length: lines }, (_, i) => `export const ${name}${i} = ${i};`).join("\n");
}

mock.module("../convex/lib/turbopuffer/getGithubAppToken", () => ({
  getGithubAppInstallationToken: async () => "token",
}));
mock.module("../convex/lib/turbopuffer/fetchGithubTree", () => ({
  fetchGithubTree: async () => ({
    commitId: "head-commit",
    branch: "main",
    entries: TREE,
    truncated: treeTruncated,
  }),
}));
mock.module("../convex/lib/turbopuffer/fetchGithubCompare", () => ({
  fetchGithubCompare: async () => compareResult,
}));
mock.module("../convex/lib/turbopuffer/embedTextBatch", () => ({
  embedTextBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
}));

// fetchGithubTarball is stubbed, but extractTarballStream is re-exported from
// the real module: tarball-reader.test.ts imports it, and bun's module mocks are
// global, so replacing the whole module would break that file depending on which
// one bun happens to load first.
const realTarball = await import("../convex/lib/turbopuffer/fetchGithubTarball");
mock.module("../convex/lib/turbopuffer/fetchGithubTarball", () => ({
  ...realTarball,
  fetchGithubTarball: async (
    _fullName: string,
    _commitId: string,
    _token: string,
    wanted: Set<string>,
  ) => {
    const contents = new Map<string, string>();
    for (const path of wanted) {
      contents.set(path, fileContents[path] ?? source(path.replace(/\W/g, "")));
    }
    return { contents };
  },
}));

function flatten(filter: unknown): string[] {
  if (!Array.isArray(filter)) return typeof filter === "string" ? [filter] : [];
  return filter.flatMap(flatten);
}

const sweeps = () => writes.filter((w) => w.delete_by_filter !== undefined);
const deletedIds = () => writes.flatMap((w) => w.deletes ?? []);
const upsertedIds = () => writes.flatMap((w) => (w.upsert_rows ?? []).map((r) => r.id));

beforeEach(() => {
  writes.length = 0;
  treeTruncated = false;
  compareResult = { usable: false, reason: "not configured" };
  fileContents = {};
});

let statusUpdates: Array<{
  status: string;
  lastIndexedCommitId?: string;
  filesIndexed?: number;
  chunksIndexed?: number;
}> = [];

async function runIndex(options: {
  lastIndexedCommit: string | null;
  compare?: unknown;
  truncated?: boolean;
  contents?: Record<string, string>;
}): Promise<Array<{ incremental: boolean; files: string[] }>> {
  statusUpdates = [];
  if (options.compare !== undefined) compareResult = options.compare;
  treeTruncated = options.truncated ?? false;
  fileContents = options.contents ?? {};

  const { runIndexRepo } = await import("../convex/lib/turbopuffer/runIndexRepo");
  type Plan = Parameters<Parameters<typeof runIndexRepo>[1]["savePlan"]>[0];
  const plans: Array<{ incremental: boolean; files: string[] }> = [];
  let plan: Plan | null = null;

  await runIndexRepo(
    {
      orgId: "org-1",
      fullName: "acme/api",
      githubId: 1,
      trigger: "merge",
      commitId: "head-commit",
      githubAppInstallationId: 42,
    },
    {
      updateStatus: async (update) => {
        statusUpdates.push({
          status: update.status,
          lastIndexedCommitId: update.lastIndexedCommitId,
          filesIndexed: update.filesIndexed,
          chunksIndexed: update.chunksIndexed,
        });
      },
      scheduleNextBatch: async () => {},
      scheduleStallWatchdog: async () => {},
      getPlan: async () => plan,
      savePlan: async (next) => {
        plan = next;
        plans.push({
          incremental: next.incremental,
          files: next.indexFiles.map((f) => f.path),
        });
      },
      getLastIndexedCommit: async () => options.lastIndexedCommit,
      drainQueuedCommit: async () => {},
    },
  );

  return plans;
}

describe("stale index sweep", () => {
  test("deletes only code_file rows, and only from other commits", async () => {
    const { deleteStaleDocuments } = await import(
      "../convex/lib/turbopuffer/deleteStaleDocuments"
    );
    await deleteStaleDocuments("org-1", "acme/api", "commit-b");

    expect(sweeps()).toHaveLength(1);
    const tokens = flatten(sweeps()[0]!.delete_by_filter);

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
    const { deleteStaleDocuments } = await import(
      "../convex/lib/turbopuffer/deleteStaleDocuments"
    );
    await deleteStaleDocuments("org-1", "acme/api", "commit-b");

    // The exact shape the sweep had before the namespace was shared. If the
    // filter ever collapses back to this, every push_delta, hunk_link, session
    // transcript and review policy row in the namespace goes with the next
    // merge.
    expect(sweeps()[0]!.delete_by_filter).not.toEqual(["commit_id", "NotEq", "commit-b"]);
  });
});

describe("chunk addressing", () => {
  test("an id depends on where a chunk lives, not on when it was written", () => {
    // The whole incremental scheme rests on this: if ids moved with the commit,
    // an unchanged file's rows would be orphaned by every merge.
    expect(documentId("acme/api", "src/a.ts", 0)).toBe(documentId("acme/api", "src/a.ts", 0));
    expect(documentId("acme/api", "src/a.ts", 0)).not.toBe(documentId("acme/api", "src/a.ts", 1));
    expect(documentId("acme/api", "src/a.ts", 0)).not.toBe(documentId("acme/api", "src/b.ts", 0));
    expect(documentId("acme/api", "src/a.ts", 0)).not.toBe(documentId("other/api", "src/a.ts", 0));
  });

  test("a file's id range covers every chunk slot it could occupy", () => {
    const ids = codeRowIdRange("acme/api", "src/a.ts", 0, MAX_CHUNKS_PER_FILE);
    expect(ids).toHaveLength(MAX_CHUNKS_PER_FILE);
    expect(ids[0]).toBe(documentId("acme/api", "src/a.ts", 0));
    expect(new Set(ids).size).toBe(MAX_CHUNKS_PER_FILE);
  });
});

describe("incremental merge pass", () => {
  test("indexes only the changed file, and never runs the stale sweep", async () => {
    const plans = await runIndex({
      lastIndexedCommit: "base-commit",
      compare: { usable: true, files: [{ path: "src/b.ts", removed: false }] },
    });

    expect(plans[0]!.incremental).toBe(true);
    expect(plans[0]!.files).toEqual(["src/b.ts"]);
    expect(upsertedIds()).toContain(documentId("acme/api", "src/b.ts", 0));
    expect(upsertedIds()).not.toContain(documentId("acme/api", "src/a.ts", 0));

    // The bug this suite exists for. After an incremental pass src/a.ts and
    // src/c.ts still carry base-commit; sweeping on `commit_id NotEq head` would
    // delete them and leave an index holding one file out of three.
    expect(sweeps()).toEqual([]);
  });

  test("a removed file's rows are retired", async () => {
    await runIndex({
      lastIndexedCommit: "base-commit",
      compare: { usable: true, files: [{ path: "src/gone.ts", removed: true }] },
    });

    expect(deletedIds()).toContain(documentId("acme/api", "src/gone.ts", 0));
    expect(deletedIds()).toContain(
      documentId("acme/api", "src/gone.ts", MAX_CHUNKS_PER_FILE - 1),
    );
    expect(sweeps()).toEqual([]);
  });

  test("a rename retires the old path as well as writing the new one", async () => {
    await runIndex({
      lastIndexedCommit: "base-commit",
      compare: {
        usable: true,
        files: [{ path: "src/b.ts", previousPath: "src/old.ts", removed: false }],
      },
    });

    // Nothing ever writes to the old path again, so without this its rows would
    // answer searches with a file that no longer exists, forever.
    expect(deletedIds()).toContain(documentId("acme/api", "src/old.ts", 0));
    expect(upsertedIds()).toContain(documentId("acme/api", "src/b.ts", 0));
  });

  test("a file that shrank has its leftover tail trimmed", async () => {
    await runIndex({
      lastIndexedCommit: "base-commit",
      compare: { usable: true, files: [{ path: "src/b.ts", removed: false }] },
      contents: { "src/b.ts": source("tiny", 2) },
    });

    const written = new Set(upsertedIds());
    const trimmed = new Set(deletedIds());
    // Every slot is accounted for exactly once: written or trimmed, never both,
    // never neither. A stale tail is a row describing code that was deleted.
    for (let i = 0; i < MAX_CHUNKS_PER_FILE; i += 1) {
      const id = documentId("acme/api", "src/b.ts", i);
      expect(written.has(id) !== trimmed.has(id)).toBe(true);
    }
  });
});

describe("what the next pass is allowed to diff from", () => {
  test("the indexed commit is recorded once, on completion", async () => {
    await runIndex({
      lastIndexedCommit: "base-commit",
      compare: { usable: true, files: [{ path: "src/b.ts", removed: false }] },
    });

    // Every mid-pass status write must leave it alone. If a starting or
    // in-progress update set it, a pass that then died would advertise a commit
    // the namespace never reached, and the next incremental pass would skip
    // every file the dead one never got to — permanently.
    const carrying = statusUpdates.filter((u) => u.lastIndexedCommitId !== undefined);
    expect(carrying).toHaveLength(1);
    expect(carrying[0]!.status).toBe("ready");
    expect(carrying[0]!.lastIndexedCommitId).toBe("head-commit");
  });

  test("a completed incremental pass reports the index's size, not the delta's", async () => {
    await runIndex({
      lastIndexedCommit: "base-commit",
      compare: { usable: true, files: [{ path: "src/b.ts", removed: false }] },
    });

    // The console reads these back as "how much of this repository is indexed".
    // Reporting the pass's own two numbers would say a three-file repository
    // holds one file and eight chunks, and it would shrink on every merge.
    const done = statusUpdates.find((u) => u.status === "ready")!;
    expect(done.filesIndexed).toBe(3);
    expect(done.chunksIndexed).toBe(4242);
  });

  test("a failed pass records nothing, so the next one rebuilds in full", async () => {
    // A tree fetch that throws stands in for any mid-pass death.
    mock.module("../convex/lib/turbopuffer/fetchGithubTree", () => ({
      fetchGithubTree: async () => {
        throw new Error("GitHub is down");
      },
    }));
    await runIndex({ lastIndexedCommit: "base-commit" });

    expect(statusUpdates.some((u) => u.status === "failed")).toBe(true);
    expect(statusUpdates.every((u) => u.lastIndexedCommitId === undefined)).toBe(true);

    mock.module("../convex/lib/turbopuffer/fetchGithubTree", () => ({
      fetchGithubTree: async () => ({
        commitId: "head-commit",
        branch: "main",
        entries: TREE,
        truncated: treeTruncated,
      }),
    }));
  });
});

describe("falling back to a full pass", () => {
  test("no previously indexed commit means a full index and a sweep", async () => {
    const plans = await runIndex({ lastIndexedCommit: null });

    expect(plans[0]!.incremental).toBe(false);
    expect(plans[0]!.files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(sweeps()).toHaveLength(1);
    expect(flatten(sweeps()[0]!.delete_by_filter)).toContain("head-commit");
  });

  test("an unusable comparison indexes in full rather than guessing", async () => {
    const plans = await runIndex({
      lastIndexedCommit: "base-commit",
      compare: { usable: false, reason: "history is diverged, not a fast-forward" },
    });

    expect(plans[0]!.incremental).toBe(false);
    expect(plans[0]!.files).toHaveLength(3);
    expect(sweeps()).toHaveLength(1);
  });

  test("a truncated tree indexes in full, because the file list is incomplete", async () => {
    const plans = await runIndex({
      lastIndexedCommit: "base-commit",
      truncated: true,
      // Would be honoured if the tree were trustworthy — it is not.
      compare: { usable: true, files: [{ path: "src/b.ts", removed: false }] },
    });

    expect(plans[0]!.incremental).toBe(false);
    expect(sweeps()).toHaveLength(1);
  });

  test("re-indexing the same commit is a full pass, not an empty delta", async () => {
    // getLastIndexedCommit === head means a forced re-index of what is already
    // there. Comparing a commit against itself yields no files, which would make
    // the pass a no-op — the one thing an explicit re-index must not be.
    const plans = await runIndex({ lastIndexedCommit: "head-commit" });

    expect(plans[0]!.incremental).toBe(false);
    expect(plans[0]!.files).toHaveLength(3);
    expect(sweeps()).toHaveLength(1);
  });
});
