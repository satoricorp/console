type StackChange = {
  jjChangeId: string;
  files: string[];
  currentCommitId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function changeFromRecord(
  changeRecord: Record<string, unknown> | null,
): StackChange | null {
  if (!changeRecord) return null;

  const jjChangeId =
    typeof changeRecord.jj_change_id === "string"
      ? changeRecord.jj_change_id
      : typeof changeRecord.jjChangeId === "string"
        ? changeRecord.jjChangeId
        : null;
  if (!jjChangeId) return null;

  const files = Array.isArray(changeRecord.files)
    ? changeRecord.files.filter((file): file is string => typeof file === "string")
    : [];

  const currentCommitId =
    typeof changeRecord.current_commit_id === "string"
      ? changeRecord.current_commit_id
      : typeof changeRecord.currentCommitId === "string"
        ? changeRecord.currentCommitId
        : null;

  return { jjChangeId, files, currentCommitId };
}

export function stackChangeFilesFromPayload(
  payload: unknown,
  jjChangeId: string,
): string[] {
  const record = asRecord(payload);
  if (!record) return [];

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (const entry of stack) {
      const entryRecord = asRecord(entry);
      const change = changeFromRecord(asRecord(entryRecord?.change ?? null));
      if (change?.jjChangeId === jjChangeId) {
        return change.files;
      }
    }
  }

  const topChange = changeFromRecord(asRecord(record.change));
  if (topChange?.jjChangeId === jjChangeId) {
    return topChange.files;
  }

  return [];
}

export function stackChangeCommitFromPayload(
  payload: unknown,
  jjChangeId: string,
): string | null {
  const record = asRecord(payload);
  if (!record) return null;

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (const entry of stack) {
      const entryRecord = asRecord(entry);
      const change = changeFromRecord(asRecord(entryRecord?.change ?? null));
      if (change?.jjChangeId === jjChangeId) {
        return change.currentCommitId;
      }
    }
  }

  const topChange = changeFromRecord(asRecord(record.change));
  if (topChange?.jjChangeId === jjChangeId) {
    return topChange.currentCommitId;
  }

  return null;
}

export type SplitSelectionInput = {
  jjChangeId: string;
  filePaths: string[];
  lineRanges: Array<{
    filePath: string;
    side: "additions" | "deletions";
    startLine: number;
    endLine: number;
  }>;
};

export function validateSplitSelection(
  payload: unknown,
  selection: SplitSelectionInput,
): { filePaths: string[]; lineRanges: SplitSelectionInput["lineRanges"] } {
  const allowedFiles = new Set(
    stackChangeFilesFromPayload(payload, selection.jjChangeId),
  );

  if (allowedFiles.size === 0) {
    throw new Error("Change not found in bookmark stack");
  }

  const filePaths = selection.filePaths.filter((path) => {
    if (!allowedFiles.has(path)) {
      throw new Error(`File not in change: ${path}`);
    }
    return true;
  });

  const wholeFileSet = new Set(filePaths);
  const lineRanges = selection.lineRanges.filter((range) => {
    if (!allowedFiles.has(range.filePath)) {
      throw new Error(`File not in change: ${range.filePath}`);
    }
    if (wholeFileSet.has(range.filePath)) {
      return false;
    }
    if (range.startLine < 1 || range.endLine < range.startLine) {
      throw new Error(`Invalid line range for ${range.filePath}`);
    }
    return true;
  });

  if (filePaths.length === 0 && lineRanges.length === 0) {
    throw new Error("Selection must include files or line ranges from this change");
  }

  return { filePaths, lineRanges };
}
