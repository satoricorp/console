export type AttributionSourceKind =
  | "agent-sessions"
  | "codebase"
  | "previous-prs"
  | "docs"
  | "pr-payload";

export type NotableCategory =
  | "behavior"
  | "failure-path"
  | "boundary"
  | "architecture"
  // Legacy values retained for stored plans.
  | "pattern"
  | "blast-radius"
  | "other";

export type AnchorConfidence = "exact" | "file" | "unverified";

export type AttributionSource = {
  source: AttributionSourceKind;
  pct: number;
};

export type NotableChange = {
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
};

export type SafeToSkimItem = {
  file: string;
  reason: string;
};

export type ReviewPlanRevision = {
  changeId: string;
  branchName?: string;
  title?: string;
};

export type ReviewPlan = {
  schemaVersion: 1;
  heuristicVersion?: number;
  narrative: {
    summary: string;
    /** One-sentence teaser shown when Summary accordion is collapsed */
    summaryTeaser: string;
    why: string;
    /** One-sentence teaser shown when Why? accordion is collapsed */
    whyTeaser: string;
    attributionSources: AttributionSource[];
    selfReportQuote?: string;
  };
  notableChanges: NotableChange[];
  safeToSkim: SafeToSkimItem[];
  revisions: ReviewPlanRevision[];
};

export type UsageTokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type UsageHarnessRow = {
  harness: string;
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** 0–100 */
  cachedPct: number;
  /** null when model is unpriced */
  costUsd: number | null;
};

export type UsageSessionRow = {
  sessionId: string;
  harness: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
};

export type UsageBreakdown = {
  totals: UsageTokenCounts & {
    totalTokens: number;
    costUsd: number | null;
    unpricedModels: number;
  };
  byHarness: UsageHarnessRow[];
  bySession: UsageSessionRow[];
  unknownModels: string[];
};

export type ReviewPlanStatus = "pending" | "ready" | "failed" | "missing";

export type ReviewChangeSummary = {
  changeId: string;
  title: string;
  description: string | null;
  files: string[];
  patch: string | null;
  branchName: string | null;
  baseBranchName: string | null;
};

export type NotablePatchSlice = {
  rank: number;
  file: string;
  revisionChangeId?: string;
  patch: string;
  lineStart?: number;
  lineEnd?: number;
};

export type ReviewActivityItem = {
  kind: "push" | "plan" | "summary" | "ci" | "decision";
  id: string;
  atMs: number;
  title: string;
  detail?: string;
};

export type ReviewPublishContext = {
  repoFullName: string;
  headBranch: string;
  baseBranch: string;
  localHeadSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
};

export type ReviewBookmarkSummary = {
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

export type ReviewResponse = {
  bookmark: ReviewBookmarkSummary;
  plan: {
    status: ReviewPlanStatus;
    stale: boolean;
    plan: ReviewPlan | null;
    model: string | null;
    provider: string | null;
    generatedAtMs: number | null;
    error: string | null;
  };
  usage: UsageBreakdown | null;
  changes: ReviewChangeSummary[];
  notablePatches: NotablePatchSlice[];
  summary: {
    content: string;
    model: string | null;
    postedAtMs: number;
  } | null;
  activity: ReviewActivityItem[];
  publishContext: ReviewPublishContext;
};
