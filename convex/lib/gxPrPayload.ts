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

