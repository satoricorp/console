import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

export type GxPrPushListItem = {
  id: string;
  sessionId?: string;
  repoFullName?: string;
  payload: unknown;
  createdAt: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const PATCH_KEYS = [
  "patch",
  "diff",
  "patchText",
  "unifiedDiff",
  "unified_diff",
] as const;

function patchFromRecord(record: Record<string, unknown>): string | null {
  for (const key of PATCH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * The per-revision entries of a bundle: schema v2 `revisions` (flat), falling
 * back to the legacy v1 `stack`. Entry-level keys (branch_name, patch, …)
 * are the same in both shapes; only v1 nests description/files under `change`.
 */
function revisionEntriesOf(record: Record<string, unknown>): unknown {
  return Array.isArray(record.revisions) && record.revisions.length > 0
    ? record.revisions
    : record.stack;
}

function patchesFromStack(stack: unknown): string[] {
  if (!Array.isArray(stack)) return [];
  const patches: string[] = [];
  for (const entry of stack) {
    const patch = patchFromRecord(asRecord(entry) ?? {});
    if (patch) patches.push(patch);
  }
  return patches;
}

function patchFromStack(stack: unknown): string | null {
  const patches = patchesFromStack(stack);
  return patches.length > 0 ? patches[patches.length - 1] : null;
}

export function extractPatch(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;

  const topLevel = patchFromRecord(record);
  if (topLevel) return topLevel;

  return patchFromStack(revisionEntriesOf(record));
}

export function extractFileDiffs(payload: unknown): FileDiffMetadata[] {
  const record = asRecord(payload);
  if (!record) return [];

  const patches: string[] = [];
  const topLevel = patchFromRecord(record);
  if (topLevel) {
    patches.push(topLevel);
  } else {
    patches.push(...patchesFromStack(revisionEntriesOf(record)));
  }

  const files: FileDiffMetadata[] = [];
  for (const patch of patches) {
    try {
      for (const parsed of parsePatchFiles(patch)) {
        files.push(...parsed.files);
      }
    } catch {
      // Skip patches Pierre cannot parse.
    }
  }
  return files;
}

function pathsFromChange(change: unknown): string[] {
  const changeRecord = asRecord(change);
  if (!changeRecord) return [];
  const files = changeRecord.files;
  if (!Array.isArray(files)) return [];
  return files.filter((f): f is string => typeof f === "string");
}

export function extractPaths(payload: unknown): string[] {
  const fromDiffs = extractFileDiffs(payload).map((file) => file.name);
  if (fromDiffs.length > 0) {
    return [...new Set(fromDiffs)];
  }

  const record = asRecord(payload);
  if (!record) return [];

  const paths: string[] = [];

  const pathsValue = record.paths ?? record.files ?? record.treePaths;
  if (Array.isArray(pathsValue)) {
    for (const entry of pathsValue) {
      if (typeof entry === "string") {
        paths.push(entry);
        continue;
      }
      const fileRecord = asRecord(entry);
      if (!fileRecord) continue;
      if (typeof fileRecord.path === "string") paths.push(fileRecord.path);
      else if (typeof fileRecord.filename === "string") paths.push(fileRecord.filename);
    }
  }

  paths.push(...pathsFromChange(record.change));

  const entries = revisionEntriesOf(record);
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const entryRecord = asRecord(entry);
      if (!entryRecord) continue;
      // v1 nests files under change; v2 revisions carry them directly.
      paths.push(...pathsFromChange(entryRecord.change));
      if (Array.isArray(entryRecord.files)) {
        paths.push(
          ...entryRecord.files.filter((f): f is string => typeof f === "string"),
        );
      }
    }
  }

  return [...new Set(paths)];
}

export function fileDiffMatchesSelection(
  fileDiff: FileDiffMetadata,
  selectedPaths: readonly string[],
): boolean {
  if (selectedPaths.length === 0) return false;
  return selectedPaths.some((selected) => {
    if (selected === fileDiff.name) return true;
    if (fileDiff.prevName && selected === fileDiff.prevName) return true;
    return fileDiff.name.startsWith(`${selected}/`);
  });
}

export function pushLabel(push: GxPrPushListItem): string {
  const record = asRecord(push.payload);
  const change = asRecord(record?.change);
  const changeTitle =
    change &&
    typeof change.description === "string" &&
    change.description.split("\n")[0]?.trim();
  const pushSection = asRecord(record?.push);
  const branch =
    (pushSection &&
      typeof pushSection.branch_name === "string" &&
      pushSection.branch_name) ||
    (record && typeof record.branch === "string" && record.branch);

  const title =
    (record && typeof record.title === "string" && record.title) ||
    (record && typeof record.name === "string" && record.name) ||
    changeTitle ||
    branch ||
    push.sessionId ||
    "PR push";

  const repo = push.repoFullName ?? "";
  return repo ? `${repo} — ${title}` : title;
}

