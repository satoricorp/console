/** Helpers for `gx pr` push bundles (CLI → gx-cloud / Convex ingest). */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function repoFullNameFromRemoteUrl(url: string): string | undefined {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (!match) return undefined;
  return `${match[1]}/${match[2]}`;
}

export function repoFullNameFromPayload(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;

  if (typeof record.repoFullName === "string") return record.repoFullName;

  const repo = asRecord(record.repo);
  if (!repo) return undefined;

  if (typeof repo.fullName === "string") return repo.fullName;
  if (typeof repo.full_name === "string") return repo.full_name;
  if (typeof repo.owner === "string" && typeof repo.name === "string") {
    return `${repo.owner}/${repo.name}`;
  }

  const remoteUrl = repo.remote_url ?? repo.remoteUrl;
  if (typeof remoteUrl === "string") {
    return repoFullNameFromRemoteUrl(remoteUrl);
  }

  return undefined;
}

export type MergeTarget = {
  repoFullName: string;
  headBranch: string;
  baseBranch: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
};

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

export function mergeTargetFromPayload(
  payload: unknown,
  repoFullName?: string,
): MergeTarget | null {
  const record = asRecord(payload);
  if (!record) return null;

  const repo = asRecord(record.repo);
  const push = asRecord(record.push);
  const stack = record.stack;

  const resolvedRepo =
    repoFullName ?? repoFullNameFromPayload(payload) ?? undefined;

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

export function headCommitIdFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;

  const push = asRecord(record.push);
  if (push && typeof push.head_commit_id === "string" && push.head_commit_id) {
    return push.head_commit_id;
  }

  const change = asRecord(record.change);
  if (
    change &&
    typeof change.current_commit_id === "string" &&
    change.current_commit_id
  ) {
    return change.current_commit_id;
  }

  return null;
}
