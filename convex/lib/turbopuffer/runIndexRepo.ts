"use node";

import { chunkSourceFile } from "./chunkSourceFile";
import { deleteStaleDocuments } from "./deleteStaleDocuments";
import { embedTextBatch } from "./embedTextBatch";
import { fetchGithubBlobs } from "./fetchGithubBlobs";
import { fetchGithubTree } from "./fetchGithubTree";
import { getGithubAppInstallationToken } from "./getGithubAppToken";
import type { IndexedDocument } from "./turbopufferClient";
import { upsertDocuments } from "./upsertDocuments";
import { CODE_FILE_SOURCE_KIND } from "./turbopufferClient";
import { indexLogMessage } from "./indexLog";
import {
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
};

export type IndexRepoCallbacks = {
  updateStatus: (update: JobStatusUpdate) => Promise<void>;
  scheduleNextBatch: (nextOffset: number) => Promise<void>;
  scheduleStallWatchdog: (checkpoint: number) => Promise<void>;
  getPlan: () => Promise<IndexPlan | null>;
  savePlan: (plan: IndexPlan) => Promise<void>;
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
      const indexFiles = indexable.slice(0, MAX_FILES).map((entry) => ({
        path: entry.path,
        sha: entry.sha,
      }));

      plan = {
        commitId: tree.commitId,
        branch: tree.branch,
        indexFiles,
        filesSkipped: tree.entries.length - indexFiles.length,
        treeTruncated: tree.truncated ?? false,
        startedAt,
        chunksIndexed: 0,
        filesIndexed: 0,
      };

      await callbacks.savePlan(plan);
      await log("Starting index", {
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

    const contents = await fetchGithubBlobs(fullName, batch, accessToken);
    let batchChunks = 0;

    for (const entry of batch) {
      const source = contents.get(entry.path);
      if (!source) continue;

      const chunks = chunkSourceFile(
        fullName,
        currentPlan.commitId,
        entry.path,
        source,
      ).slice(0, MAX_CHUNKS_PER_FILE);

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
  await deleteStaleDocuments(orgId, fullName, plan.commitId);

  await log("Index complete", {
    commitId: plan.commitId,
    filesIndexed: plan.indexFiles.length,
    filesTotal: plan.indexFiles.length,
    chunksIndexed: plan.chunksIndexed,
  });

  await callbacks.updateStatus({
    fullName,
    status: "ready",
    commitId: plan.commitId,
    filesTotal: plan.indexFiles.length,
    filesIndexed: plan.indexFiles.length,
    chunksIndexed: plan.chunksIndexed,
    filesSkipped: plan.filesSkipped,
    treeTruncated: plan.treeTruncated,
    defaultBranch: plan.branch,
    startedAt: plan.startedAt,
    completedAt: Date.now(),
    clearIndexFiles: true,
  });

  // Last, and only once the pass is finalized: a merge that arrived mid-run is
  // started now, so a busy repository does not fall behind HEAD waiting for
  // someone to merge again.
  await callbacks.drainQueuedCommit();

  console.log(
    `[index] ${fullName}@${plan.commitId.slice(0, 7)} done · ${plan.indexFiles.length} files · ${plan.chunksIndexed} chunks · trigger=${trigger}`,
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
