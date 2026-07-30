import type { PublishRevision } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return out.length ? out : undefined;
}

/**
 * Normalize a publish bundle (or its JSONB payload) to a flat revision list.
 * Schema v2 bundles carry `revisions` directly; v1 bundles carry the legacy
 * stack/change shape, where `jj_change_id` already held the TX trailer
 * revision ID. Values may come straight from pr_events.payload, so every
 * field is runtime-checked rather than trusted.
 */
export function publishRevisions(payload: {
  revisions?: unknown;
  stack?: unknown;
  change?: unknown;
}): PublishRevision[] {
  if (Array.isArray(payload.revisions)) {
    const revisions = payload.revisions.filter(isRecord).map((entry) => ({
      revision_id: str(entry.revision_id),
      commit_id: str(entry.commit_id),
      description: str(entry.description),
      files: strArray(entry.files),
      branch_name: str(entry.branch_name),
      base_branch_name: str(entry.base_branch_name),
      patch: str(entry.patch),
      github_pull_request_url: str(entry.github_pull_request_url),
      review_context: isRecord(entry.review_context) ? entry.review_context : undefined,
    }));
    if (revisions.length) return revisions;
  }

  if (Array.isArray(payload.stack)) {
    const revisions = payload.stack.filter(isRecord).map((entry) => {
      const change = isRecord(entry.change) ? entry.change : {};
      return {
        revision_id: str(change.jj_change_id),
        commit_id: str(change.current_commit_id),
        description: str(change.description),
        files: strArray(change.files),
        branch_name: str(entry.branch_name),
        base_branch_name: str(entry.base_branch_name),
        patch: str(entry.patch),
        github_pull_request_url: str(entry.github_pull_request_url),
        review_context: isRecord(change.review_context) ? change.review_context : undefined,
      };
    });
    if (revisions.length) return revisions;
  }

  if (isRecord(payload.change)) {
    const change = payload.change;
    return [
      {
        revision_id: str(change.jj_change_id),
        commit_id: str(change.current_commit_id),
        description: str(change.description),
        files: strArray(change.files),
        branch_name: undefined,
        base_branch_name: undefined,
        patch: undefined,
        github_pull_request_url: undefined,
        review_context: isRecord(change.review_context) ? change.review_context : undefined,
      },
    ];
  }

  return [];
}
