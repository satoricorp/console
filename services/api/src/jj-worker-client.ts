export type ApplyResult = {
  bookmarkId: string;
  revision: number;
  headCommitId: string;
  remoteHeadSha: string | null;
  newJjChangeId?: string | null;
  stackPayload?: Record<string, unknown> | null;
};

export type SplitLineRange = {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
};

export type JjOp =
  | {
      type: "relocate_change";
      changeId: string;
      parentChangeId: string;
    }
  | { type: "restack"; changeIds?: string[] }
  | { type: "amend"; changeId: string; description?: string }
  | {
      type: "squash";
      sourceChangeId: string;
      targetChangeId: string;
    }
  | { type: "describe"; changeId: string; description: string }
  | { type: "rebase"; ontoChangeId: string; changeIds: string[] }
  | {
      type: "split_to_change";
      sourceChangeId: string;
      sourceCommitId?: string;
      description: string;
      filePaths?: string[];
      lineRanges?: SplitLineRange[];
    };

function workerUrl(): string {
  const url = process.env.JJ_WORKER_URL?.trim();
  if (!url) {
    throw new Error("JJ_WORKER_URL is not set");
  }
  return url.replace(/\/$/, "");
}

function serviceApiKey(): string {
  const key = process.env.GX_CLOUD_API_KEY?.trim();
  if (!key) {
    throw new Error("GX_CLOUD_API_KEY is not set");
  }
  return key;
}

export async function applyBookmarkOps(input: {
  bookmarkId: string;
  userId: string;
  ops: JjOp[];
}): Promise<ApplyResult> {
  const response = await fetch(`${workerUrl()}/apply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  let payload: ApplyResult | { error?: string };
  try {
    payload = (await response.json()) as ApplyResult | { error?: string };
  } catch {
    throw new Error(`jj-worker returned invalid JSON (${response.status})`);
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `jj-worker request failed (${response.status})`;
    throw new WorkerRequestError(response.status, message);
  }

  return payload as ApplyResult;
}

export class WorkerRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkerRequestError";
    this.status = status;
  }
}
