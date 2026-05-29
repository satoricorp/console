export type ExportedChangePayload = {
  id: number;
  jj_change_id: string;
  current_commit_id: string;
  description: string;
  parent_change_id?: string;
  status: string;
  files: string[];
};

export type ExportedStackPayload = {
  change: ExportedChangePayload;
  branch_name: string;
  base_branch_name: string;
  patch: string;
  github_pull_request_url?: string;
};

export type ExportedPushBundle = {
  event: string;
  created_at: number;
  gx_version: string;
  repo: Record<string, unknown>;
  push: Record<string, unknown>;
  change?: ExportedChangePayload;
  stack?: ExportedStackPayload[];
  sessions?: unknown[];
  metadata?: Record<string, string>;
};
