export type AuthContext = {
  orgId: string;
  userId: string;
  tokenLabel: string;
  githubUserId?: number;
  githubUserLogin?: string;
  sessionId?: string;
  machineId?: string;
};

export type PublishRegistration = {
  repo_full_name: string;
  branch_name: string;
  title?: string;
  head_commit_id: string;
  remote_head_sha?: string;
  github_pr_url?: string;
};

export type PushBundle = {
  event: string;
  created_at: number;
  gx_version: string;
  pr_id?: string;
  review_id?: string;
  review_url?: string;
  index_status?: string;
  repo: {
    root_path: string;
    backend: string;
    default_remote?: string;
    default_branch?: string;
    remote_url?: string;
    branch_name?: string;
  };
  push: {
    remote_name?: string;
    branch_name?: string;
    head_commit_id: string;
    github_pull_request_url?: string;
  };
  change?: {
    description?: string;
    files?: string[];
  };
  stack?: Array<{
    change?: {
      description?: string;
      files?: string[];
    };
    branch_name?: string;
    base_branch_name?: string;
    patch?: string;
    github_pull_request_url?: string;
  }>;
  sessions?: unknown[];
  metadata?: Record<string, string>;
};

export type HunkLinkInput = {
  hunkID: string;
  sessionID?: string;
  tier: number;
  confidence: number;
  authorship: string;
  tool?: string;
  model?: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type ExtractBody = {
  repoRoot: string;
  refRange: string;
  headCommit: string;
  gxVersion?: string;
  intentCandidates?: unknown[];
  hunkLinks: HunkLinkInput[];
  struggleSignals?: unknown[];
  humanOverrides?: unknown[];
  fileStats?: unknown;
  toolVersions?: Record<string, string>;
};

export type SessionBody = {
  sessionId: string;
  tool: string;
  model?: string;
  content: string;
  capturedAtMs?: number;
};
