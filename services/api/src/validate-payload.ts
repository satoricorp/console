import type { PushBundle } from "./types";

export class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PayloadValidationError(`Missing or invalid ${key}`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PayloadValidationError(`Missing or invalid ${key}`);
  }
  return value;
}

export function validatePushBundle(body: unknown): PushBundle {
  if (!isRecord(body)) {
    throw new PayloadValidationError("Body must be a JSON object");
  }

  const event = requireString(body, "event");
  if (event !== "gx.pr") {
    throw new PayloadValidationError(`Unsupported event: ${event}`);
  }

  const created_at = requireNumber(body, "created_at");
  const gx_version = requireString(body, "gx_version");

  if (!isRecord(body.repo)) {
    throw new PayloadValidationError("Missing or invalid repo");
  }
  const repoRoot = requireString(body.repo, "root_path");
  const repoBackend = requireString(body.repo, "backend");

  if (!isRecord(body.push)) {
    throw new PayloadValidationError("Missing or invalid push");
  }
  const headCommitId = requireString(body.push, "head_commit_id");

  if (body.sessions !== undefined && !Array.isArray(body.sessions)) {
    throw new PayloadValidationError("sessions must be an array");
  }

  if (body.stack !== undefined && !Array.isArray(body.stack)) {
    throw new PayloadValidationError("stack must be an array");
  }

  return body as PushBundle & {
    repo: { root_path: string; backend: string };
    push: { head_commit_id: string };
  };
}

export function extractIndexFields(payload: PushBundle) {
  return {
    repo_root_path: payload.repo.root_path,
    repo_backend: payload.repo.backend,
    remote_url: payload.repo.remote_url ?? null,
    branch_name: payload.push.branch_name ?? payload.repo.branch_name ?? null,
    head_commit_id: payload.push.head_commit_id,
    github_pr_url: payload.push.github_pull_request_url ?? null,
  };
}
