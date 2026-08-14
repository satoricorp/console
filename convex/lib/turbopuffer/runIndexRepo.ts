"use node";

import { chunkSourceFile } from "./chunkSourceFile";
import {
  countIndexedChunks,
  deleteDocumentIds,
  deleteStaleDocuments,
} from "./deleteStaleDocuments";
import { embedTextBatch } from "./embedTextBatch";
import { fetchGithubCompare } from "./fetchGithubCompare";
import { fetchGithubTarball } from "./fetchGithubTarball";
import { fetchGithubTree } from "./fetchGithubTree";
import { getGithubAppInstallationToken } from "./getGithubAppToken";
import type { IndexedDocument } from "./turbopufferClient";
import { upsertDocuments } from "./upsertDocuments";
import { CODE_FILE_SOURCE_KIND } from "./turbopufferClient";
import { indexLogMessage } from "./indexLog";
import {
  codeRowIdRange,
  FILE_BATCH,
  MAX_CHUNKS_PER_FILE,
  MAX_FILES,
  shouldIndexPath,
  sortIndexableEntries,
} from "./utils";

export type IndexRepoRequest = {
  /** The org whose namespace this index is written to. */
  orgId: string;
  fullName: string;
  githubId: number;
  commitId?: string;
  trigger: "connect" | "merge";
  githubAccessToken?: string;
  githubAppInstallationId?: number;
  batchOffset?: number;
};

export type IndexPlan = {
  commitId: string;
  branch: string;
  indexFiles: Array<{ path: string; sha: string }>;
  filesSkipped: number;
  treeTruncated: boolean;
  startedAt: number;
  chunksIndexed: number;
  filesIndexed: number;
  /**
   * Whether indexFiles is the changed subset rather than the whole repository.
   *
   * Carried on the plan, not recomputed, because a resumed batch has to finish
   * the pass it started: the stale sweep is only correct after a full pass, and
   * a resume that forgot which kind of pass this was would run it against a
   * namespace where most rows still carry the previous commit id.
   */
  incremental: boolean;
  /**
   * Indexable files in the repository at this commit — not the count this pass
   * is touching. An incremental pass writes a handful of files, and reporting
   * that as the index size would tell the console a 3,500-file repository holds
   * two.
   */
  repoFileCount: number;
};

export type JobStatusUpdate = {
  fullName: string;
  status: "pending" | "indexing" | "ready" | "failed";
  commitId?: string;
  filesTotal?: number;
  filesIndexed?: number;
  chunksIndexed?: number;
  filesSkipped?: number;
  treeTruncated?: boolean;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  defaultBranch?: string;
  clearIndexFiles?: boolean;
  indexLog?: string;
  /** Set only by finalizeIndex — see the schema comment on this field. */
  lastIndexedCommitId?: string;
};

export type IndexRepoCallbacks = {
  updateStatus: (update: JobStatusUpdate) => Promise<void>;
  scheduleNextBatch: (nextOffset: number) => Promise<void>;
  scheduleStallWatchdog: (checkpoint: number) => Promise<void>;
  getPlan: () => Promise<IndexPlan | null>;
  savePlan: (plan: IndexPlan) => Promise<void>;
  /**
   * The commit this repository's namespace currently reflects, or null if no
   * pass has ever finished. Only a completed pass counts: diffing from a commit
   * whose pass died halfway would treat the files it never reached as unchanged
   * and leave permanent holes in the index.
   */
  getLastIndexedCommit: () => Promise<string | null>;
  /** Starts the commit that landed mid-run, if one did. */
  drainQueuedCommit: () => Promise<void>;
};

export async function runIndexRepo(
  request: IndexRepoRequest,
  callbacks: IndexRepoCallbacks,
) {
  const { fullName, trigger } = request;
  let offset = request.batchOffset ?? 0;

  const log = async (
    message: string,
    parts: {
      commitId?: string;
      filesIndexed?: number;
      filesTotal?: number;
      chunksIndexed?: number;
      batchOffset?: number;
    } = {},
  ) => {
    const line = indexLogMessage(fullName, parts, message);
    console.log(line);
    await callbacks.updateStatus({ fullName, status: "indexing", indexLog: line });
  };

  try {
    const accessToken = await resolveAccessToken(request);
    let plan = await callbacks.getPlan();

    const sameCommit =
      !request.commitId || !plan || request.commitId === plan.commitId;
    if (
      offset === 0 &&
      plan &&
      plan.filesIndexed > 0 &&
      plan.filesIndexed < plan.indexFiles.length &&
      sameCommit
    ) {
      offset = plan.filesIndexed;
      await log("Job incomplete — resuming where we left off", {
        commitId: plan.commitId,
        filesIndexed: plan.filesIndexed,
        filesTotal: plan.indexFiles.length,
        chunksIndexed: plan.chunksIndexed,
        batchOffset: offset,
      });
    }

    if (offset === 0) {
      // Read before the status flips to "indexing": that write is what would
      // otherwise erase the record of which commit the namespace reflects.
      const lastIndexedCommit = await callbacks.getLastIndexedCommit();

      const startedAt = Date.now();
      await callbacks.updateStatus({ fullName, status: "indexing", startedAt });

      const tree = await fetchGithubTree(
        fullName,
        accessToken,
        request.commitId,
      );

      const indexable = sortIndexableEntries(
        tree.entries.filter((entry) => shouldIndexPath(entry.path, entry.size)),
      );
      const currentFiles = indexable.slice(0, MAX_FILES).map((entry) => ({
        path: entry.path,
        sha: entry.sha,
      }));
      const filesSkipped = tree.entries.length - currentFiles.length;

      // Only a merge onto an already-indexed commit can be a delta. A connect
      // has nothing to diff against, and a truncated tree means the file list
      // itself is incomplete, so "unchanged" would be a guess.
      const delta =
        lastIndexedCommit && lastIndexedCommit !== tree.commitId && !tree.truncated
          ? await planIncremental(
              fullName,
              lastIndexedCommit,
              tree.commitId,
              accessToken,
              currentFiles,
            )
          : null;

      if (delta) {
        // Retiring deleted and renamed-away files happens before any batch, so
        // a pass that dies partway has still removed rows pointing at code that
        // is gone — the failure that would otherwise serve deleted files as
        // current until someone noticed.
        await deleteDocumentIds(request.orgId, fullName, delta.retiredIds);
        await log(
          `Incremental index from ${lastIndexedCommit!.slice(0, 9)}: ` +
            `${delta.indexFiles.length} changed file(s), ` +
            `${delta.retiredIds.length / MAX_CHUNKS_PER_FILE} retired`,
          { commitId: tree.commitId },
        );
      } else if (lastIndexedCommit) {
        await log(
          `Full index — ${deltaSkipReason(tree.truncated, lastIndexedCommit === tree.commitId)}`,
          { commitId: tree.commitId },
        );
      }

      const indexFiles = delta ? delta.indexFiles : currentFiles;

      plan = {
        commitId: tree.commitId,
        branch: tree.branch,
        indexFiles,
        // Files this pass is not touching are not "skipped" in the sense the
        // console reports — they are already indexed and still correct.
        filesSkipped,
        treeTruncated: tree.truncated ?? false,
        startedAt,
        chunksIndexed: 0,
        filesIndexed: 0,
        incremental: delta !== null,
        repoFileCount: currentFiles.length,
      };

      await callbacks.savePlan(plan);
      await log(plan.incremental ? "Starting incremental index" : "Starting index", {
        commitId: plan.commitId,
        filesIndexed: 0,
        filesTotal: indexFiles.length,
        chunksIndexed: 0,
      });
      await callbacks.updateStatus({
        fullName,
        status: "indexing",
        commitId: plan.commitId,
        filesTotal: indexFiles.length,
        filesIndexed: 0,
        chunksIndexed: 0,
        filesSkipped: plan.filesSkipped,
        treeTruncated: plan.treeTruncated,
        defaultBranch: plan.branch,
        startedAt: plan.startedAt,
      });
    }

    if (!plan) {
      throw new Error(`Missing index plan for ${fullName}`);
    }

    const currentPlan = plan;
    const batch = currentPlan.indexFiles.slice(offset, offset + FILE_BATCH);
    if (batch.length === 0) {
      await finalizeIndex(request.orgId, fullName, currentPlan, callbacks, trigger, log);
      return;
    }

    await log("Processing batch", {
      commitId: currentPlan.commitId,
      filesIndexed: offset,
      filesTotal: currentPlan.indexFiles.length,
      chunksIndexed: currentPlan.chunksIndexed,
      batchOffset: offset,
    });

    await callbacks.scheduleStallWatchdog(offset);

    // One request for this batch's files instead of one per file. The blob
    // endpoint cost a request each against an installation's 5000 per hour, so
    // a 422-file repository spent 422 of them on a single index — and that
    // budget is shared, so exhausting it took PR summaries and @gx replies down
    // with it for the rest of the hour.
    const { contents } = await fetchGithubTarball(
      fullName,
      currentPlan.commitId,
      accessToken,
      new Set(batch.map((entry) => entry.path)),
    );
    let batchChunks = 0;
    // Ids this batch's files no longer occupy. On a full pass the stale sweep
    // covers these, because every current row is rewritten with the new commit
    // id and a leftover tail keeps the old one. An incremental pass rewrites
    // almost nothing, so it has to name them.
    const trimmedIds: string[] = [];

    for (const entry of batch) {
      const source = contents.get(entry.path);
      if (!source) continue;

      const chunks = chunkSourceFile(fullName, entry.path, source).slice(
        0,
        MAX_CHUNKS_PER_FILE,
      );

      if (currentPlan.incremental) {
        // A file that shrank, or that now sniffs as binary and yields nothing,
        // leaves rows behind at the indexes it used to fill.
        trimmedIds.push(
          ...codeRowIdRange(fullName, entry.path, chunks.length, MAX_CHUNKS_PER_FILE),
        );
      }

      if (chunks.length === 0) continue;

      const vectors = await embedTextBatch(chunks.map((chunk) => chunk.content));
      // Field names are the shared namespace's, not this indexer's: the body
      // column is `text`, the branch is `branch_name`, and `symbol` is written
      // twice — once into the unstemmed full-text column and once into the
      // filterable `symbol_name` — because that is the shape the server and
      // the CLI already write and a reader cannot tell rows apart by origin.
      const documents: IndexedDocument[] = chunks.map((chunk, idx) => ({
        id: chunk.id,
        vector: vectors[idx],
        text: chunk.content,
        symbol: chunk.symbol,
        org_id: request.orgId,
        repo_full_name: fullName,
        source_kind: CODE_FILE_SOURCE_KIND,
        file_path: chunk.filePath,
        symbol_name: chunk.symbol,
        branch_name: currentPlan.branch,
        chunk_hash: chunk.chunkHash,
        commit_id: currentPlan.commitId,
        language: chunk.language,
        doc_type: chunk.docType,
        indexed_reason: request.trigger,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        created_at: Date.now(),
      }));

      await upsertDocuments(request.orgId, fullName, documents);
      batchChunks += documents.length;
    }

    // After the upserts, so a run that dies between the two leaves a stale tail
    // rather than a hole: the next pass over this file rewrites both.
    await deleteDocumentIds(request.orgId, fullName, trimmedIds);

    const filesIndexed = offset + batch.length;
    const chunksIndexed = currentPlan.chunksIndexed + batchChunks;
    plan = { ...currentPlan, chunksIndexed, filesIndexed };

    await callbacks.savePlan(plan);
    await callbacks.updateStatus({
      fullName,
      status: "indexing",
      commitId: plan.commitId,
      filesTotal: plan.indexFiles.length,
      filesIndexed,
      chunksIndexed,
      filesSkipped: plan.filesSkipped,
      treeTruncated: plan.treeTruncated,
      defaultBranch: plan.branch,
      startedAt: plan.startedAt,
    });

    const nextOffset = offset + FILE_BATCH;
    if (nextOffset < plan.indexFiles.length) {
      await log("Batch done — not finished, scheduling next batch", {
        commitId: plan.commitId,
        filesIndexed,
        filesTotal: plan.indexFiles.length,
        chunksIndexed,
        batchOffset: nextOffset,
      });
      await callbacks.scheduleNextBatch(nextOffset);
      return;
    }

    await finalizeIndex(request.orgId, fullName, plan, callbacks, trigger, log);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown indexing error";
    console.error(`Index failed for ${fullName}:`, error);

    const failedPlan = await callbacks.getPlan();
    const line = indexLogMessage(
      fullName,
      {
        commitId: failedPlan?.commitId,
        filesIndexed: failedPlan?.filesIndexed,
        filesTotal: failedPlan?.indexFiles.length,
        chunksIndexed: failedPlan?.chunksIndexed,
        batchOffset: request.batchOffset,
      },
      `Failed — job incomplete, resume from last checkpoint · ${message}`,
    );
    console.log(line);

    await callbacks.updateStatus({
      fullName,
      status: "failed",
      error: message,
      indexLog: line,
      completedAt: Date.now(),
    });

    // Drain on failure too. The queued commit is only started when a pass
    // finishes, so a pass that dies stranded it: satoricorp/console failed on
    // an oversized embedding input holding 6e38e32, and nothing would have
    // started it. A newer commit is also the better thing to try next — it may
    // not contain whatever the failed pass choked on — and draining clears the
    // field either way, so this cannot loop.
    await callbacks.drainQueuedCommit();
  }
}

function deltaSkipReason(
  treeTruncated: boolean | undefined,
  sameCommit: boolean,
): string {
  if (sameCommit) {
    // A re-index of the commit already indexed. Comparing it against itself
    // would report nothing changed, turning an explicit rebuild into a no-op.
    return "this commit is already the indexed one, so there is nothing to diff against";
  }
  return treeTruncated
    ? "the tree is truncated, so the file list is incomplete"
    : "no usable comparison against the last indexed commit";
}

/**
 * Turn "what changed on GitHub" into "what this pass must write and unwrite".
 *
 * Returns null when the comparison cannot be trusted, and the caller falls back
 * to a full pass. Every changed path lands in exactly one of two buckets: it is
 * indexable at the new commit and gets re-chunked, or it is not — deleted,
 * renamed away, grown past the size cap, or now a skipped extension — and its
 * rows are retired. A path that changed but is not indexable in either
 * generation retires ids that were never written, which TurboPuffer ignores.
 */
async function planIncremental(
  fullName: string,
  lastIndexedCommit: string,
  headCommitId: string,
  accessToken: string,
  currentFiles: Array<{ path: string; sha: string }>,
): Promise<{ indexFiles: Array<{ path: string; sha: string }>; retiredIds: string[] } | null> {
  let compare;
  try {
    compare = await fetchGithubCompare(
      fullName,
      lastIndexedCommit,
      headCommitId,
      accessToken,
    );
  } catch (error) {
    // A full pass is always correct, so a comparison that errors is a cost
    // problem, not a correctness one — log it and rebuild.
    console.warn(`compare failed for ${fullName}, indexing in full:`, error);
    return null;
  }
  if (!compare.usable) {
    console.info(`compare unusable for ${fullName} (${compare.reason}), indexing in full`);
    return null;
  }

  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const indexFiles: Array<{ path: string; sha: string }> = [];
  const seen = new Set<string>();
  const retiredIds: string[] = [];

  for (const file of compare.files) {
    // A rename moves content to a new id; the old path's rows would otherwise
    // survive forever, since nothing ever writes to them again.
    if (file.previousPath && file.previousPath !== file.path) {
      retiredIds.push(
        ...codeRowIdRange(fullName, file.previousPath, 0, MAX_CHUNKS_PER_FILE),
      );
    }

    const current = currentByPath.get(file.path);
    if (!current || file.removed) {
      retiredIds.push(...codeRowIdRange(fullName, file.path, 0, MAX_CHUNKS_PER_FILE));
      continue;
    }
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    indexFiles.push(current);
  }

  return { indexFiles, retiredIds };
}

async function finalizeIndex(
  orgId: string,
  fullName: string,
  plan: IndexPlan,
  callbacks: IndexRepoCallbacks,
  trigger: IndexRepoRequest["trigger"],
  log: (
    message: string,
    parts?: {
      commitId?: string;
      filesIndexed?: number;
      filesTotal?: number;
      chunksIndexed?: number;
      batchOffset?: number;
    },
  ) => Promise<void>,
) {
  // Full passes only. After an incremental pass most rows still carry the
  // previous commit id — correctly, because their files did not change — and
  // this filter would delete every one of them, leaving an index holding just
  // the handful of files that happened to be touched.
  if (!plan.incremental) {
    await deleteStaleDocuments(orgId, fullName, plan.commitId);
  }

  // The console reports these as "how much of this repository is indexed", so
  // once the pass is done they have to describe the index, not the pass. For a
  // full pass the two are the same number; for an incremental one they are not
  // remotely, and reporting the delta would say a 3,500-file repository holds
  // the two files that changed.
  const indexedChunks = plan.incremental
    ? await countIndexedChunks(orgId, fullName)
    : plan.chunksIndexed;

  await log(plan.incremental ? "Incremental index complete" : "Index complete", {
    commitId: plan.commitId,
    filesIndexed: plan.indexFiles.length,
    filesTotal: plan.indexFiles.length,
    chunksIndexed: plan.chunksIndexed,
  });

  await callbacks.updateStatus({
    fullName,
    status: "ready",
    commitId: plan.commitId,
    filesTotal: plan.repoFileCount,
    filesIndexed: plan.repoFileCount,
    chunksIndexed: indexedChunks ?? plan.chunksIndexed,
    filesSkipped: plan.filesSkipped,
    treeTruncated: plan.treeTruncated,
    defaultBranch: plan.branch,
    startedAt: plan.startedAt,
    completedAt: Date.now(),
    clearIndexFiles: true,
    // Here and nowhere else: this is the moment the namespace is known to match
    // a commit end to end, which is the only claim the next pass may diff from.
    lastIndexedCommitId: plan.commitId,
  });

  // Last, and only once the pass is finalized: a merge that arrived mid-run is
  // started now, so a busy repository does not fall behind HEAD waiting for
  // someone to merge again.
  await callbacks.drainQueuedCommit();

  console.log(
    `[index] ${fullName}@${plan.commitId.slice(0, 7)} done · ` +
      `${plan.indexFiles.length}/${plan.repoFileCount} files · ${plan.chunksIndexed} chunks written · ` +
      `trigger=${trigger}${plan.incremental ? " (incremental)" : ""}`,
  );
}

async function resolveAccessToken(request: IndexRepoRequest): Promise<string> {
  if (request.trigger === "connect") {
    if (!request.githubAccessToken) {
      throw new Error("githubAccessToken is required for connect trigger");
    }
    return request.githubAccessToken;
  }

  const installationId =
    request.githubAppInstallationId ??
    Number(process.env.GITHUB_APP_INSTALLATION_ID);

  if (Number.isFinite(installationId)) {
    return getGithubAppInstallationToken(installationId);
  }

  if (request.githubAccessToken) {
    return request.githubAccessToken;
  }

  throw new Error(
    "GitHub App installation id or githubAccessToken required for merge trigger",
  );
}
