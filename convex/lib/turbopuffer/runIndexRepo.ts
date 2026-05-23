"use node";

import { chunkSourceFile } from "./chunkSourceFile";
import { deleteStaleDocuments } from "./deleteStaleDocuments";
import { embedTextBatch } from "./embedTextBatch";
import { fetchGithubBlobs } from "./fetchGithubBlobs";
import { fetchGithubTree } from "./fetchGithubTree";
import { getGithubAppInstallationToken } from "./getGithubAppToken";
import type { IndexedDocument } from "./turbopufferClient";
import { upsertDocuments } from "./upsertDocuments";
import {
  FILE_BATCH,
  MAX_CHUNKS_PER_FILE,
  MAX_FILES,
  shouldIndexPath,
  sortIndexableEntries,
} from "./utils";

export type IndexRepoRequest = {
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
};

export type IndexRepoCallbacks = {
  updateStatus: (update: JobStatusUpdate) => Promise<void>;
  scheduleNextBatch: (nextOffset: number) => Promise<void>;
  getPlan: () => Promise<IndexPlan | null>;
  savePlan: (plan: IndexPlan) => Promise<void>;
};

export async function runIndexRepo(
  request: IndexRepoRequest,
  callbacks: IndexRepoCallbacks,
) {
  const { fullName, trigger } = request;
  const offset = request.batchOffset ?? 0;

  try {
    const accessToken = await resolveAccessToken(request);
    let plan = await callbacks.getPlan();

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
      };

      await callbacks.savePlan(plan);
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
      await finalizeIndex(fullName, currentPlan, callbacks, trigger);
      return;
    }

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
      const documents: IndexedDocument[] = chunks.map((chunk, idx) => ({
        id: chunk.id,
        vector: vectors[idx],
        content: chunk.content,
        file_path: chunk.filePath,
        symbol: chunk.symbol,
        repo_id: fullName,
        commit_id: currentPlan.commitId,
        branch: currentPlan.branch,
        language: chunk.language,
        doc_type: chunk.docType,
        created_at: Date.now(),
      }));

      await upsertDocuments(fullName, documents);
      batchChunks += documents.length;
    }

    const filesIndexed = offset + batch.length;
    const chunksIndexed = currentPlan.chunksIndexed + batchChunks;
    plan = { ...currentPlan, chunksIndexed };

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
      await callbacks.scheduleNextBatch(nextOffset);
      return;
    }

    await finalizeIndex(fullName, plan, callbacks, trigger);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown indexing error";
    console.error(`Index failed for ${fullName}:`, error);

    await callbacks.updateStatus({
      fullName,
      status: "failed",
      error: message,
      completedAt: Date.now(),
    });
  }
}

async function finalizeIndex(
  fullName: string,
  plan: IndexPlan,
  callbacks: IndexRepoCallbacks,
  trigger: IndexRepoRequest["trigger"],
) {
  await deleteStaleDocuments(fullName, plan.commitId);

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

  console.log(
    `Indexed ${fullName}@${plan.commitId} (${plan.indexFiles.length} files, ${plan.chunksIndexed} chunks, trigger=${trigger})`,
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
