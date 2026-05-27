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

function patchFromStack(stack: unknown): string | null {
  if (!Array.isArray(stack) || stack.length === 0) return null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = asRecord(stack[i]);
    const patch = entry?.patch;
    if (typeof patch === "string" && patch.trim().length > 0) return patch;
  }
  return null;
}

export function extractPatch(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;

  for (const key of ["patch", "diff", "patchText", "unifiedDiff", "unified_diff"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  const fromStack = patchFromStack(record.stack);
  if (fromStack) return fromStack;

  return null;
}

function pathsFromChange(change: unknown): string[] {
  const changeRecord = asRecord(change);
  if (!changeRecord) return [];
  const files = changeRecord.files;
  if (!Array.isArray(files)) return [];
  return files.filter((f): f is string => typeof f === "string");
}

export function extractPaths(payload: unknown): string[] {
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

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (const entry of stack) {
      const stackRecord = asRecord(entry);
      paths.push(...pathsFromChange(stackRecord?.change));
    }
  }

  return [...new Set(paths)];
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
