import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

export type MergeTarget = {
  repoFullName: string;
  headBranch: string;
  baseBranch: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
};

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

  return patchFromStack(record.stack);
}

export function extractFileDiffs(payload: unknown): FileDiffMetadata[] {
  const record = asRecord(payload);
  if (!record) return [];

  const patches: string[] = [];
  const topLevel = patchFromRecord(record);
  if (topLevel) {
    patches.push(topLevel);
  } else {
    patches.push(...patchesFromStack(record.stack));
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

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (const entry of stack) {
      const stackRecord = asRecord(entry);
      paths.push(...pathsFromChange(stackRecord?.change));
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

function repoFullNameFromRemoteUrl(url: string): string | undefined {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (!match) return undefined;
  return `${match[1]}/${match[2]}`;
}

function repoFullNameFromPayloadRecord(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;

  if (typeof record.repoFullName === "string") return record.repoFullName;

  const repo = asRecord(record.repo);
  if (!repo) return undefined;

  const remoteUrl = repo.remote_url ?? repo.remoteUrl;
  if (typeof remoteUrl === "string") {
    return repoFullNameFromRemoteUrl(remoteUrl);
  }

  return undefined;
}

function parsePullRequestNumber(url: string): number | undefined {
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : undefined;
}

function pullRequestUrlFromRecord(
  record: Record<string, unknown>,
): string | undefined {
  const push = asRecord(record.push);
  const fromPush = push?.github_pull_request_url;
  if (typeof fromPush === "string" && fromPush.includes("/pull/")) {
    return fromPush;
  }

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const entry = asRecord(stack[index]);
      const url = entry?.github_pull_request_url;
      if (typeof url === "string" && url.includes("/pull/")) {
        return url;
      }
    }
  }

  return typeof fromPush === "string" ? fromPush : undefined;
}

export function extractMergeTarget(
  payload: unknown,
  repoFullName?: string,
): MergeTarget | null {
  const record = asRecord(payload);
  if (!record) return null;

  const repo = asRecord(record.repo);
  const push = asRecord(record.push);
  const stack = record.stack;

  const resolvedRepo =
    repoFullName ?? repoFullNameFromPayloadRecord(payload) ?? undefined;

  let headBranch =
    (push && typeof push.branch_name === "string" && push.branch_name) ||
    (repo && typeof repo.branch_name === "string" && repo.branch_name) ||
    (typeof record.branch === "string" && record.branch) ||
    undefined;

  let baseBranch =
    (repo && typeof repo.default_branch === "string" && repo.default_branch) ||
    "main";

  if (Array.isArray(stack) && stack.length > 0) {
    const lastEntry = asRecord(stack[stack.length - 1]);
    if (lastEntry && typeof lastEntry.base_branch_name === "string") {
      baseBranch = lastEntry.base_branch_name;
    }
    if (!headBranch && typeof lastEntry?.branch_name === "string") {
      headBranch = lastEntry.branch_name;
    }
  }

  if (!resolvedRepo || !headBranch) return null;

  const pullRequestUrl = pullRequestUrlFromRecord(record);
  const pullRequestNumber = pullRequestUrl
    ? parsePullRequestNumber(pullRequestUrl)
    : undefined;

  return {
    repoFullName: resolvedRepo,
    headBranch,
    baseBranch,
    pullRequestUrl,
    pullRequestNumber,
  };
}
