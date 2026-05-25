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

export function extractPatch(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;

  for (const key of ["patch", "diff", "patchText", "unifiedDiff", "unified_diff"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return null;
}

export function extractPaths(payload: unknown): string[] {
  const record = asRecord(payload);
  if (!record) return [];

  const pathsValue = record.paths ?? record.files ?? record.treePaths;
  if (!Array.isArray(pathsValue)) return [];

  const paths: string[] = [];
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

  return [...new Set(paths)];
}

export function pushLabel(push: GxPrPushListItem): string {
  const record = asRecord(push.payload);
  const title =
    (record && typeof record.title === "string" && record.title) ||
    (record && typeof record.name === "string" && record.name) ||
    push.sessionId ||
    "PR push";

  const repo = push.repoFullName ?? "";
  return repo ? `${repo} — ${title}` : title;
}
