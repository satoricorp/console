import { chunkSourceFile } from "./chunk-source-file";
import { deleteStaleDocuments } from "./delete-stale-documents";
import { embedTextBatch } from "./embed-text-batch";
import { fetchGithubBlobs } from "./fetch-github-blobs";
import { fetchGithubTree } from "./fetch-github-tree";
import { getGithubAppInstallationToken } from "./get-github-app-token";
import { reportJobStatus } from "./report-job-status";
import type { IndexedDocument } from "./turbopuffer-client";
import { upsertDocuments } from "./upsert-documents";
import { MAX_FILES, shouldIndexPath } from "./utils";

export type IndexRepoRequest = {
  fullName: string;
  githubId: number;
  commitId?: string;
  trigger: "connect" | "merge";
  githubAccessToken?: string;
  callbackUrl?: string;
};

const inFlight = new Map<string, AbortController>();
const pendingCommit = new Map<string, string>();

export async function indexRepo(request: IndexRepoRequest) {
  const { fullName } = request;

  if (request.commitId) {
    pendingCommit.set(fullName, request.commitId);
  }

  const existing = inFlight.get(fullName);
  if (existing) {
    existing.abort();
  }

  const controller = new AbortController();
  inFlight.set(fullName, controller);

  try {
    await runIndex(request, controller.signal);
  } finally {
    if (inFlight.get(fullName) === controller) {
      inFlight.delete(fullName);
    }
  }
}

async function runIndex(request: IndexRepoRequest, signal: AbortSignal) {
  const { fullName, trigger } = request;
  const startedAt = Date.now();

  await reportJobStatus({
    fullName,
    status: "indexing",
    startedAt,
  });

  try {
    const accessToken = await resolveAccessToken(request);

    const tree = await fetchGithubTree(
      fullName,
      accessToken,
      request.commitId,
    );

    if (
      request.commitId &&
      pendingCommit.get(fullName) !== undefined &&
      pendingCommit.get(fullName) !== tree.commitId
    ) {
      console.log(`Skipping stale index for ${fullName}@${tree.commitId}`);
      return;
    }

    const indexable = tree.entries
      .filter((entry) => shouldIndexPath(entry.path, entry.size))
      .slice(0, MAX_FILES);

    await reportJobStatus({
      fullName,
      status: "indexing",
      filesTotal: indexable.length,
      filesIndexed: 0,
      defaultBranch: tree.branch,
      startedAt,
    });

    await deleteStaleDocuments(fullName, tree.commitId);

    const FILE_BATCH = 50;
    let filesIndexed = 0;
    let chunksIndexed = 0;

    for (let i = 0; i < indexable.length; i += FILE_BATCH) {
      if (signal.aborted) return;

      const batch = indexable.slice(i, i + FILE_BATCH);
      const contents = await fetchGithubBlobs(
        fullName,
        batch.map((entry) => ({ path: entry.path, sha: entry.sha })),
        accessToken,
      );

      const allChunks = [];
      for (const entry of batch) {
        const source = contents.get(entry.path);
        if (!source) continue;
        allChunks.push(
          ...chunkSourceFile(fullName, tree.commitId, entry.path, source),
        );
      }

      if (allChunks.length > 0) {
        const vectors = await embedTextBatch(allChunks.map((c) => c.content));
        const documents: IndexedDocument[] = allChunks.map((chunk, idx) => ({
          id: chunk.id,
          vector: vectors[idx],
          content: chunk.content,
          file_path: chunk.filePath,
          symbol: chunk.symbol,
          repo_id: fullName,
          commit_id: tree.commitId,
          branch: tree.branch,
          language: chunk.language,
          doc_type: chunk.docType,
          created_at: Date.now(),
        }));

        await upsertDocuments(fullName, documents);
        chunksIndexed += documents.length;
      }

      filesIndexed += batch.length;

      await reportJobStatus({
        fullName,
        status: "indexing",
        commitId: tree.commitId,
        filesTotal: indexable.length,
        filesIndexed,
        chunksIndexed,
        defaultBranch: tree.branch,
        startedAt,
      });
    }

    await reportJobStatus({
      fullName,
      status: "ready",
      commitId: tree.commitId,
      filesTotal: indexable.length,
      filesIndexed,
      chunksIndexed,
      defaultBranch: tree.branch,
      startedAt,
      completedAt: Date.now(),
    });

    console.log(
      `Indexed ${fullName}@${tree.commitId} (${filesIndexed} files, ${chunksIndexed} chunks, trigger=${trigger})`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown indexing error";
    console.error(`Index failed for ${fullName}:`, error);

    await reportJobStatus({
      fullName,
      status: "failed",
      error: message,
      startedAt,
      completedAt: Date.now(),
    });
  }
}

async function resolveAccessToken(request: IndexRepoRequest): Promise<string> {
  if (request.trigger === "connect") {
    if (!request.githubAccessToken) {
      throw new Error("githubAccessToken is required for connect trigger");
    }
    return request.githubAccessToken;
  }

  const installationId = Number(process.env.GITHUB_APP_INSTALLATION_ID);
  if (!Number.isFinite(installationId)) {
    if (request.githubAccessToken) {
      return request.githubAccessToken;
    }
    throw new Error(
      "GITHUB_APP_INSTALLATION_ID or githubAccessToken required for merge trigger",
    );
  }

  return getGithubAppInstallationToken(installationId);
}

export function scheduleIndexRepo(request: IndexRepoRequest) {
  void indexRepo(request);
}
