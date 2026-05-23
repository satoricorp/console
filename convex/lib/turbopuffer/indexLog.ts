export function indexLogMessage(
  fullName: string,
  parts: {
    commitId?: string;
    filesIndexed?: number;
    filesTotal?: number;
    chunksIndexed?: number;
    batchOffset?: number;
  },
  message: string,
): string {
  const progress =
    parts.filesIndexed !== undefined && parts.filesTotal !== undefined
      ? `${parts.filesIndexed}/${parts.filesTotal} files`
      : undefined;
  const chunks =
    parts.chunksIndexed !== undefined
      ? `${parts.chunksIndexed} chunks`
      : undefined;
  const commit = parts.commitId ? `@${parts.commitId.slice(0, 7)}` : "";
  const offset =
    parts.batchOffset !== undefined ? `offset=${parts.batchOffset}` : undefined;

  return [
    `[index] ${fullName}${commit}`,
    progress,
    chunks,
    offset,
    message,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function isIndexJobIncomplete(job: {
  status: string;
  indexFiles?: unknown[];
  filesTotal?: number;
  filesIndexed?: number;
}): boolean {
  return (
    job.status === "indexing" &&
    !!job.indexFiles &&
    job.filesTotal !== undefined &&
    (job.filesIndexed ?? 0) < job.filesTotal
  );
}
