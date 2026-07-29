import { createHash } from "node:crypto";
import type postgres from "postgres";
import { searchCodeReviewHistory, type IndexSearchResult } from "../indexing/search";
import {
  indexCodeReviewHistory,
  type CodeReviewHistoryIndexInput,
  type IndexJobResult,
} from "../indexing/turbopuffer";

export type CodeReviewHistoryFindingInput = {
  fingerprint?: string;
  outcome?: string;
  category?: string;
  language?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  title: string;
  summary: string;
  recommendation?: string;
  confidence?: number;
  severity?: string;
  payload?: Record<string, unknown>;
};

type NormalizedFinding = CodeReviewHistoryFindingInput & {
  outcome: "valid" | "false_positive" | "already_fixed" | "suppressed";
  category: string;
  language: string;
  filePath: string;
  title: string;
  summary: string;
};

export type CodeReviewHistoryRecordInput = {
  repoRootPath?: string;
  repoFullName: string;
  branchName?: string;
  headCommitId?: string;
  sourceKind?: string;
  sourceRef?: string;
  prompt?: string;
  scope?: string;
  mode?: string;
  reviewer?: string;
  findings?: CodeReviewHistoryFindingInput[];
  summaryText?: string;
  summaryKind?: string;
  payload?: Record<string, unknown>;
};

export type CodeReviewHistoryRecordResult = {
  runId: string;
  summaryId: string;
  findingCount: number;
  indexStatus: IndexJobResult["status"];
  indexError?: string;
};

export type CodeReviewHistorySearchInput = {
  repoFullName: string;
  query?: string;
  fingerprints?: string[];
  filePaths?: string[];
  categories?: string[];
  language?: string;
  limit?: number;
};

type FindingRow = {
  id: string;
  run_id: string;
  fingerprint: string;
  outcome: string;
  category: string;
  language: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  title: string;
  summary: string;
  recommendation: string | null;
  confidence: number | null;
  severity: string | null;
  created_at_ms: number;
  payload: unknown;
};

type SummaryRow = {
  id: string;
  run_id: string;
  summary_kind: string;
  summary_text: string;
  summary_json: unknown;
  created_at_ms: number;
};

export async function recordCodeReviewHistory(
  db: postgres.Sql,
  orgId: string,
  userId: string,
  input: CodeReviewHistoryRecordInput,
): Promise<CodeReviewHistoryRecordResult> {
  const now = Date.now();
  const findings = normalizeFindings(input.findings ?? []);
  const summaryText = input.summaryText?.trim() || buildReviewSummary({ ...input, findings });
  const runPayload = input.payload ?? {};
  const sourceKind = clean(input.sourceKind) || "session_intent";

  const inserted = await db.begin(async (tx) => {
    const [run] = await tx<{ id: string }[]>`
      INSERT INTO code_review_history_runs (
        org_id, user_id, repo_root_path, repo_full_name, branch_name, head_commit_id,
        source_kind, source_ref, prompt, scope, mode, reviewer, finding_count,
        created_at_ms, payload
      ) VALUES (
        ${orgId}, ${userId}, ${nullable(input.repoRootPath)}, ${input.repoFullName},
        ${nullable(input.branchName)}, ${nullable(input.headCommitId)}, ${sourceKind},
        ${nullable(input.sourceRef)}, ${nullable(input.prompt)}, ${nullable(input.scope)},
        ${nullable(input.mode)}, ${nullable(input.reviewer)}, ${findings.length}, ${now},
        ${tx.json(runPayload as postgres.JSONValue)}
      )
      RETURNING id
    `;

    const findingRows: Array<{ id: string }> = [];
    for (const finding of findings) {
      const fingerprint = finding.fingerprint || fingerprintForFinding(input.repoFullName, finding);
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO code_review_history_findings (
          org_id, run_id, repo_full_name, fingerprint, outcome, category, language,
          file_path, line_start, line_end, title, summary, recommendation,
          confidence, severity, created_at_ms, payload
        ) VALUES (
          ${orgId}, ${run.id}, ${input.repoFullName}, ${fingerprint}, ${finding.outcome},
          ${finding.category}, ${finding.language}, ${finding.filePath},
          ${nullableNumber(finding.lineStart)}, ${nullableNumber(finding.lineEnd)},
          ${finding.title}, ${finding.summary}, ${nullable(finding.recommendation)},
          ${nullableNumber(finding.confidence)}, ${nullable(finding.severity)}, ${now},
          ${tx.json((finding.payload ?? {}) as postgres.JSONValue)}
        )
        RETURNING id
      `;
      findingRows.push(row);
      finding.fingerprint = fingerprint;
    }

    const [summary] = await tx<{ id: string }[]>`
      INSERT INTO code_review_history_summaries (
        org_id, run_id, repo_full_name, branch_name, head_commit_id,
        summary_kind, summary_text, summary_json, model, created_at_ms
      ) VALUES (
        ${orgId}, ${run.id}, ${input.repoFullName}, ${nullable(input.branchName)},
        ${nullable(input.headCommitId)}, ${clean(input.summaryKind) || "pr"}, ${summaryText},
        ${tx.json(summaryPayload(input, findings) as postgres.JSONValue)}, 'deterministic', ${now}
      )
      RETURNING id
    `;

    return { runId: run.id, summaryId: summary.id, findingIds: findingRows.map((row) => row.id) };
  });

  const indexInput: CodeReviewHistoryIndexInput = {
    orgId,
    repoFullName: input.repoFullName,
    runId: inserted.runId,
    summaryId: inserted.summaryId,
    branchName: clean(input.branchName),
    headSha: clean(input.headCommitId),
    prompt: clean(input.prompt),
    scope: clean(input.scope),
    mode: clean(input.mode),
    reviewer: clean(input.reviewer),
    summaryText,
    findings: findings.map((finding, index) => ({
      id: inserted.findingIds[index] ?? "",
      fingerprint: finding.fingerprint ?? "",
      outcome: finding.outcome,
      category: finding.category,
      language: finding.language,
      filePath: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      title: finding.title,
      summary: finding.summary,
      recommendation: finding.recommendation,
      confidence: finding.confidence,
      severity: finding.severity,
    })),
  };
  const index = await indexCodeReviewHistory(indexInput);
  return {
    runId: inserted.runId,
    summaryId: inserted.summaryId,
    findingCount: findings.length,
    indexStatus: index.status,
    indexError: index.error,
  };
}

export async function loadCodeReviewHistory(
  db: postgres.Sql,
  orgId: string,
  input: CodeReviewHistorySearchInput,
): Promise<{
  exactMatches: FindingRow[];
  similarMatches: IndexSearchResult[];
  summaries: SummaryRow[];
}> {
  const limit = clampLimit(input.limit);
  const fingerprints = stringList(input.fingerprints);
  const filePaths = stringList(input.filePaths);
  const categories = stringList(input.categories);
  const language = clean(input.language);

  const exactMatches = await db<FindingRow[]>`
    SELECT id, run_id, fingerprint, outcome, category, language, file_path,
      line_start, line_end, title, summary, recommendation, confidence,
      severity, created_at_ms, payload
    FROM code_review_history_findings
    WHERE org_id = ${orgId}
      AND repo_full_name = ${input.repoFullName}
      AND (${fingerprints.length === 0} OR fingerprint = ANY(${fingerprints}))
      AND (${filePaths.length === 0} OR file_path = ANY(${filePaths}))
      AND (${categories.length === 0} OR category = ANY(${categories}))
      AND (${language === ""} OR language = ${language})
    ORDER BY created_at_ms DESC
    LIMIT ${limit}
  `;

  const summaries = await db<SummaryRow[]>`
    SELECT id, run_id, summary_kind, summary_text, summary_json, created_at_ms
    FROM code_review_history_summaries
    WHERE org_id = ${orgId}
      AND repo_full_name = ${input.repoFullName}
    ORDER BY created_at_ms DESC
    LIMIT ${Math.min(limit, 10)}
  `;

  const similarMatches = await searchCodeReviewHistory({
    orgId,
    repoFullName: input.repoFullName,
    query: input.query ?? "",
    limit,
  });

  return { exactMatches, similarMatches, summaries };
}

export function buildReviewSummary(input: CodeReviewHistoryRecordInput): string {
  const findings = normalizeFindings(input.findings ?? []);
  const valid = findings.filter((finding) => finding.outcome === "valid");
  const suppressed = findings.filter((finding) => finding.outcome !== "valid");
  const categoryCounts = new Map<string, number>();
  for (const finding of findings) {
    categoryCounts.set(finding.category, (categoryCounts.get(finding.category) ?? 0) + 1);
  }
  const categories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");
  const lines = [
    `Code review summary for ${input.repoFullName}`,
    clean(input.branchName) ? `Branch: ${clean(input.branchName)}` : "",
    clean(input.headCommitId) ? `Head: ${clean(input.headCommitId)}` : "",
    `Findings: ${findings.length} total, ${valid.length} valid, ${suppressed.length} non-actionable`,
    categories ? `Categories: ${categories}` : "",
  ].filter(Boolean);
  for (const finding of valid.slice(0, 5)) {
    lines.push(`- ${finding.title}: ${finding.summary}`);
  }
  return lines.join("\n");
}

function normalizeFindings(findings: CodeReviewHistoryFindingInput[]): NormalizedFinding[] {
  return findings.flatMap((finding) => {
    const title = clean(finding.title);
    const summary = clean(finding.summary);
    if (!title || !summary) return [];
    const outcome = normalizeOutcome(finding.outcome);
    return [{
      ...finding,
      title,
      summary,
      outcome,
      category: clean(finding.category) || "general",
      language: clean(finding.language),
      filePath: clean(finding.filePath),
      recommendation: clean(finding.recommendation),
      severity: clean(finding.severity),
      confidence: clampConfidence(finding.confidence),
    }];
  });
}

function normalizeOutcome(value?: string): "valid" | "false_positive" | "already_fixed" | "suppressed" {
  switch (clean(value)) {
    case "false_positive":
    case "already_fixed":
    case "suppressed":
      return clean(value) as "false_positive" | "already_fixed" | "suppressed";
    default:
      return "valid";
  }
}

function summaryPayload(input: CodeReviewHistoryRecordInput, findings: CodeReviewHistoryFindingInput[]): Record<string, unknown> {
  return {
    prompt: clean(input.prompt),
    scope: clean(input.scope),
    mode: clean(input.mode),
    reviewer: clean(input.reviewer),
    finding_count: findings.length,
    categories: [...new Set(findings.map((finding) => clean(finding.category)).filter(Boolean))],
  };
}

function fingerprintForFinding(repoFullName: string, finding: CodeReviewHistoryFindingInput): string {
  return createHash("sha256")
    .update([
      repoFullName,
      clean(finding.category),
      clean(finding.filePath),
      String(finding.lineStart ?? ""),
      clean(finding.title),
      clean(finding.summary),
    ].join("\x00"))
    .digest("hex")
    .slice(0, 32);
}

function clean(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value?: string): string | null {
  const cleaned = clean(value);
  return cleaned || null;
}

function nullableNumber(value?: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampConfidence(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.round(value), 1), 10);
}

function clampLimit(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.min(Math.max(Math.round(value), 1), 50);
}

function stringList(value?: string[]): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, 50) : [];
}
