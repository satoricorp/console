export type AttributionSourceKind =
  | "agent-sessions"
  | "codebase"
  | "previous-prs"
  | "docs";

export type NotableCategory =
  | "architecture"
  | "pattern"
  | "blast-radius"
  | "other";

export type AnchorConfidence = "exact" | "file" | "unverified";

export type ReviewPlan = {
  schemaVersion: 1;
  narrative: {
    summary: string;
    summaryTeaser: string;
    why: string;
    whyTeaser: string;
    attributionSources: Array<{ source: AttributionSourceKind; pct: number }>;
    selfReportQuote?: string;
  };
  notableChanges: Array<{
    rank: number;
    category: NotableCategory;
    title: string;
    whyItMatters: string;
    anchor: {
      file: string;
      lineStart?: number;
      lineEnd?: number;
      revisionChangeId?: string;
    };
    anchorConfidence: AnchorConfidence;
    attribution?: {
      authorship: string;
      tool?: string;
      model?: string;
    };
  }>;
  safeToSkim: Array<{ file: string; reason: string }>;
  revisions: Array<{
    changeId: string;
    branchName?: string;
    title?: string;
  }>;
};

export type UsageBreakdown = {
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costUsd: number | null;
    unpricedModels: number;
  };
  byHarness: Array<{
    harness: string;
    model: string;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cachedPct: number;
    costUsd: number | null;
  }>;
  bySession: Array<{
    sessionId: string;
    harness: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number | null;
  }>;
  unknownModels: string[];
};

export type ReviewResponse = {
  bookmark: {
    id: string;
    orgId: string;
    userId: string;
    repoFullName: string;
    branchName: string;
    title: string | null;
    revision: number;
    headCommitId: string | null;
    remoteHeadSha: string | null;
    mergeStatus: string;
    githubPrUrl: string | null;
    githubPrNumber: number | null;
    publishedAtMs: number;
    updatedAtMs: number;
    riskLevel: string | null;
    riskScore: number | null;
    fileCount: number;
    revisionCount: number;
    pushedBy: string | null;
  };
  plan: {
    status: "pending" | "ready" | "failed" | "missing";
    stale: boolean;
    plan: ReviewPlan | null;
    model: string | null;
    provider: string | null;
    generatedAtMs: number | null;
    error: string | null;
  };
  usage: UsageBreakdown | null;
  changes: Array<{
    changeId: string;
    title: string;
    description: string | null;
    files: string[];
    patch: string | null;
    branchName: string | null;
    baseBranchName: string | null;
  }>;
  notablePatches: Array<{
    file: string;
    revisionChangeId?: string;
    patch: string;
    lineStart?: number;
    lineEnd?: number;
  }>;
  summary: {
    content: string;
    model: string | null;
    postedAtMs: number;
  } | null;
  activity: Array<{
    kind: "push" | "plan" | "summary" | "ci" | "decision";
    id: string;
    atMs: number;
    title: string;
    detail?: string;
  }>;
  publishContext: {
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
    localHeadSha: string | null;
    pullRequestNumber: number | null;
    pullRequestUrl: string | null;
  };
};

export async function fetchReview(bookmarkId: string): Promise<ReviewResponse> {
  const response = await fetch(`/api/reviews/${bookmarkId}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to load review (${response.status})`);
  }
  return (await response.json()) as ReviewResponse;
}

export async function regenerateReviewPlan(
  bookmarkId: string,
  force = true,
): Promise<void> {
  const response = await fetch(`/api/reviews/${bookmarkId}/plan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to regenerate plan (${response.status})`);
  }
}

export async function recordReviewDecision(
  bookmarkId: string,
  body: {
    action: "approve";
    merged: boolean;
    mergeSha?: string;
    prNumber?: number;
    reason?: string;
  },
): Promise<void> {
  const response = await fetch(`/api/reviews/${bookmarkId}/decision`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Failed to record decision (${response.status})`);
  }
}
