import { Hono } from "hono";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { loadCodeReviewHistory, recordCodeReviewHistory } from "../review/history";

export const reviewHistoryRoutes = new Hono<AppEnv>();

reviewHistoryRoutes.use("/v1/code-review-history/*", requireAuth);

reviewHistoryRoutes.post("/v1/code-review-history/record", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => null);
  if (!isRecord(body)) {
    return c.json({ error: "valid JSON body is required" }, 400);
  }
  const repoFullName = stringValue(body.repoFullName || body.repo_full_name);
  if (!repoFullName) {
    return c.json({ error: "repoFullName is required" }, 400);
  }
  const findings = Array.isArray(body.findings) ? body.findings.flatMap(parseFinding) : [];
  const result = await recordCodeReviewHistory(getSql(), auth.orgId, auth.userId, {
    repoRootPath: stringValue(body.repoRootPath || body.repo_root_path),
    repoFullName,
    branchName: stringValue(body.branchName || body.branch_name),
    headCommitId: stringValue(body.headCommitId || body.head_commit_id),
    sourceKind: stringValue(body.sourceKind || body.source_kind),
    sourceRef: stringValue(body.sourceRef || body.source_ref),
    clientSurface:
      stringValue(body.client || body.clientSurface || body.client_surface) ||
      stringValue(c.req.header("x-gx-client")),
    prompt: stringValue(body.prompt),
    scope: stringValue(body.scope),
    mode: stringValue(body.mode),
    reviewer: stringValue(body.reviewer),
    summaryText: stringValue(body.summaryText || body.summary_text),
    summaryKind: stringValue(body.summaryKind || body.summary_kind),
    findings,
    payload: recordValue(body.payload) ?? {},
  });
  return c.json(result);
});

reviewHistoryRoutes.post("/v1/code-review-history/search", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => null);
  if (!isRecord(body)) {
    return c.json({ error: "valid JSON body is required" }, 400);
  }
  const repoFullName = stringValue(body.repoFullName || body.repo_full_name);
  if (!repoFullName) {
    return c.json({ error: "repoFullName is required" }, 400);
  }
  const result = await loadCodeReviewHistory(getSql(), auth.orgId, {
    repoFullName,
    query: stringValue(body.query),
    fingerprints: stringArray(body.fingerprints),
    filePaths: stringArray(body.filePaths || body.file_paths),
    categories: stringArray(body.categories),
    language: stringValue(body.language),
    limit: numberValue(body.limit),
  });
  return c.json(result);
});

function parseFinding(value: unknown) {
  if (!isRecord(value)) return [];
  const title = stringValue(value.title);
  const summary = stringValue(value.summary);
  if (!title || !summary) return [];
  return [{
    fingerprint: stringValue(value.fingerprint),
    outcome: stringValue(value.outcome),
    category: stringValue(value.category),
    language: stringValue(value.language),
    filePath: stringValue(value.filePath || value.file_path),
    lineStart: numberValue(value.lineStart || value.line_start),
    lineEnd: numberValue(value.lineEnd || value.line_end),
    title,
    summary,
    recommendation: stringValue(value.recommendation),
    confidence: numberValue(value.confidence),
    severity: stringValue(value.severity),
    payload: recordValue(value.payload) ?? {},
  }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}
