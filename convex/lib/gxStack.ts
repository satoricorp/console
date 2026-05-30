/** Stack change extraction from `gx pr` push bundles. */

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

function changeFromRecord(
  changeRecord: Record<string, unknown> | null,
): {
  id: number;
  jjChangeId: string;
  description: string;
  files: string[];
  currentCommitId: string | null;
} | null {
  if (!changeRecord) return null;

  const jjChangeId =
    typeof changeRecord.jj_change_id === "string"
      ? changeRecord.jj_change_id
      : typeof changeRecord.jjChangeId === "string"
        ? changeRecord.jjChangeId
        : null;
  if (!jjChangeId) return null;

  const id =
    typeof changeRecord.id === "number" && Number.isFinite(changeRecord.id)
      ? changeRecord.id
      : 0;

  const description =
    typeof changeRecord.description === "string"
      ? changeRecord.description.trim()
      : "";

  const files = Array.isArray(changeRecord.files)
    ? changeRecord.files.filter((file): file is string => typeof file === "string")
    : [];

  const currentCommitId =
    typeof changeRecord.current_commit_id === "string"
      ? changeRecord.current_commit_id
      : null;

  return { id, jjChangeId, description, files, currentCommitId };
}

export type StackChangeItem = {
  stackIndex: number;
  jjChangeId: string;
  changeId: number;
  description: string;
  branchName: string;
  baseBranchName: string;
  patch: string | null;
  githubPullRequestUrl?: string;
  files: string[];
  currentCommitId: string | null;
};

export const DEFAULT_APPROVAL_THRESHOLD_PERCENT = 70;

function orderStackChangesOldestFirst(items: StackChangeItem[]): StackChangeItem[] {
  const sorted = [...items].sort(
    (left, right) =>
      left.changeId - right.changeId || left.stackIndex - right.stackIndex,
  );
  return sorted.map((item, index) => ({
    ...item,
    stackIndex: index,
  }));
}

export function extractStackChanges(payload: unknown): StackChangeItem[] {
  const record = asRecord(payload);
  if (!record) return [];

  const stack = record.stack;
  if (Array.isArray(stack) && stack.length > 0) {
    const items: StackChangeItem[] = [];
    for (let index = 0; index < stack.length; index += 1) {
      const entry = asRecord(stack[index]);
      if (!entry) continue;

      const change = changeFromRecord(asRecord(entry.change));
      if (!change) continue;

      const branchName =
        typeof entry.branch_name === "string" ? entry.branch_name : "";
      const baseBranchName =
        typeof entry.base_branch_name === "string"
          ? entry.base_branch_name
          : "main";
      const githubPullRequestUrl =
        typeof entry.github_pull_request_url === "string"
          ? entry.github_pull_request_url
          : undefined;

      items.push({
        stackIndex: index,
        jjChangeId: change.jjChangeId,
        changeId: change.id,
        description: change.description,
        branchName,
        baseBranchName,
        patch: patchFromRecord(entry),
        githubPullRequestUrl,
        files: change.files,
        currentCommitId: change.currentCommitId,
      });
    }
    return orderStackChangesOldestFirst(items);
  }

  const topChange = changeFromRecord(asRecord(record.change));
  if (!topChange) return [];

  const repo = asRecord(record.repo);
  const push = asRecord(record.push);
  const branchName =
    (push && typeof push.branch_name === "string" && push.branch_name) ||
    (repo && typeof repo.branch_name === "string" && repo.branch_name) ||
    "";
  const baseBranchName =
    (repo && typeof repo.default_branch === "string" && repo.default_branch) ||
    "main";

  return [
    {
      stackIndex: 0,
      jjChangeId: topChange.jjChangeId,
      changeId: topChange.id,
      description: topChange.description,
      branchName,
      baseBranchName,
      patch: patchFromRecord(record),
      githubPullRequestUrl:
        push && typeof push.github_pull_request_url === "string"
          ? push.github_pull_request_url
          : undefined,
      files: topChange.files,
      currentCommitId: topChange.currentCommitId,
    },
  ];
}

export type ChangeReviewRecord = {
  jjChangeId: string;
  stackIndex: number;
  approvalPercent: number;
  notes?: string;
};

export function reviewMapFromRecords(
  reviews: ChangeReviewRecord[],
): Map<string, ChangeReviewRecord> {
  return new Map(reviews.map((review) => [review.jjChangeId, review]));
}

export function stackApprovalSummary(
  changes: StackChangeItem[],
  reviews: Map<string, ChangeReviewRecord>,
  thresholdPercent: number,
): {
  totalChanges: number;
  reviewedChanges: number;
  approvedChanges: number;
  allApproved: boolean;
  nextUnreviewedIndex: number | null;
  blockedReason: string | null;
} {
  if (changes.length === 0) {
    return {
      totalChanges: 0,
      reviewedChanges: 0,
      approvedChanges: 0,
      allApproved: true,
      nextUnreviewedIndex: null,
      blockedReason: null,
    };
  }

  let reviewedChanges = 0;
  let approvedChanges = 0;
  let nextUnreviewedIndex: number | null = null;

  for (const change of changes) {
    const review = reviews.get(change.jjChangeId);
    if (review) {
      reviewedChanges += 1;
      if (review.approvalPercent >= thresholdPercent) {
        approvedChanges += 1;
      } else if (nextUnreviewedIndex === null) {
        nextUnreviewedIndex = change.stackIndex;
      }
    } else if (nextUnreviewedIndex === null) {
      nextUnreviewedIndex = change.stackIndex;
    }
  }

  const allApproved = approvedChanges === changes.length;
  let blockedReason: string | null = null;
  if (!allApproved) {
    const pending = changes.find((change) => {
      const review = reviews.get(change.jjChangeId);
      return !review || review.approvalPercent < thresholdPercent;
    });
    if (pending) {
      const label = pending.description.split("\n")[0]?.trim() || pending.jjChangeId;
      blockedReason = `Change ${pending.stackIndex + 1} (${label}) needs approval at ${thresholdPercent}% or higher.`;
    }
  }

  return {
    totalChanges: changes.length,
    reviewedChanges,
    approvedChanges,
    allApproved,
    nextUnreviewedIndex,
    blockedReason,
  };
}

export function stackChangeFromPayload(
  payload: unknown,
  jjChangeId: string,
): StackChangeItem | null {
  return extractStackChanges(payload).find((change) => change.jjChangeId === jjChangeId) ?? null;
}

export function payloadForStackChange(change: StackChangeItem): {
  stack: Array<{
    change: {
      id: number;
      jj_change_id: string;
      description: string;
      files: string[];
      current_commit_id: string | null;
    };
    branch_name: string;
    base_branch_name: string;
    patch?: string;
    github_pull_request_url?: string;
  }>;
} {
  return {
    stack: [
      {
        change: {
          id: change.changeId,
          jj_change_id: change.jjChangeId,
          description: change.description,
          files: change.files,
          current_commit_id: change.currentCommitId,
        },
        branch_name: change.branchName,
        base_branch_name: change.baseBranchName,
        ...(change.patch ? { patch: change.patch } : {}),
        ...(change.githubPullRequestUrl
          ? { github_pull_request_url: change.githubPullRequestUrl }
          : {}),
      },
    ],
  };
}
