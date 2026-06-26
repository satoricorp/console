import { createHash } from "node:crypto";
import type postgres from "postgres";
import {
  embeddingDimensions,
  indexingConfig,
  namespaceForOrgRepo,
  openAIEmbeddingModel,
  type IndexingConfig,
} from "./config";
import type { PushBundle } from "../types";

const maxChunkBytes = 4_000;

export type IndexChunk = {
  id: string;
  text: string;
  attributes: Record<string, unknown>;
};

export type IndexJobResult = {
  status: "disabled" | "indexed" | "empty" | "failed";
  chunks: number;
  error?: string;
};

export type IndexSearchResult = {
  id: string;
  score?: number;
  text: string;
  attributes: Record<string, unknown>;
};

export type PushIndexInput = {
  orgId: string;
  repoFullName: string;
  ref?: string;
  afterSha?: string;
  commitMessages?: string[];
  reason: string;
};

export type PublishArtifactIndexInput = {
  orgId: string;
  repoFullName: string;
  eventId: string;
  branchName: string;
  headSha: string;
  payload: PushBundle;
};

export type CodeReviewHistoryIndexInput = {
  orgId: string;
  repoFullName: string;
  runId: string;
  summaryId: string;
  branchName?: string;
  headSha?: string;
  prompt?: string;
  scope?: string;
  mode?: string;
  reviewer?: string;
  summaryText: string;
  findings: Array<{
    id: string;
    fingerprint: string;
    outcome: string;
    category: string;
    language?: string;
    filePath?: string;
    lineStart?: number;
    lineEnd?: number;
    title: string;
    summary: string;
    recommendation?: string;
    confidence?: number;
    severity?: string;
  }>;
};

type FetchFn = typeof fetch;

let fetchOverride: FetchFn | null = null;

export function setIndexingFetch(impl: FetchFn): void {
  fetchOverride = impl;
}

export function resetIndexingFetch(): void {
  fetchOverride = null;
}

function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const fn = fetchOverride ?? globalThis.fetch;
  return fn(input, init);
}

export async function runIncrementalIndex(
  db: postgres.Sql,
  input: PushIndexInput,
): Promise<IndexJobResult> {
  const cfg = indexingConfig();
  if (!cfg) {
    return { status: "disabled", chunks: 0 };
  }

  try {
    const chunks = await buildIncrementalChunks(db, input);
    if (chunks.length === 0) {
      return { status: "empty", chunks: 0 };
    }

    const namespace = namespaceForOrgRepo(input.orgId, input.repoFullName);
    for (let start = 0; start < chunks.length; start += 64) {
      const batch = chunks.slice(start, start + 64);
      const embeddings = await embedTexts(cfg, batch.map((chunk) => chunk.text));
      await upsertTurboPufferRows(cfg, namespace, batch, embeddings);
    }
    return { status: "indexed", chunks: chunks.length };
  } catch (error) {
    return {
      status: "failed",
      chunks: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function indexPublishedArtifact(
  input: PublishArtifactIndexInput,
): Promise<IndexJobResult> {
  const cfg = indexingConfig();
  if (!cfg) {
    return { status: "disabled", chunks: 0 };
  }

  try {
    const chunks = buildPublishedArtifactChunks(input);
    if (chunks.length === 0) {
      return { status: "empty", chunks: 0 };
    }
    const namespace = namespaceForOrgRepo(input.orgId, input.repoFullName);
    for (let start = 0; start < chunks.length; start += 64) {
      const batch = chunks.slice(start, start + 64);
      const embeddings = await embedTexts(cfg, batch.map((chunk) => chunk.text));
      await upsertTurboPufferRows(cfg, namespace, batch, embeddings);
    }
    return { status: "indexed", chunks: chunks.length };
  } catch (error) {
    return {
      status: "failed",
      chunks: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function indexCodeReviewHistory(
  input: CodeReviewHistoryIndexInput,
): Promise<IndexJobResult> {
  const cfg = indexingConfig();
  if (!cfg) {
    return { status: "disabled", chunks: 0 };
  }

  try {
    const chunks = buildCodeReviewHistoryChunks(input);
    if (chunks.length === 0) {
      return { status: "empty", chunks: 0 };
    }
    const namespace = namespaceForOrgRepo(input.orgId, input.repoFullName);
    for (let start = 0; start < chunks.length; start += 64) {
      const batch = chunks.slice(start, start + 64);
      const embeddings = await embedTexts(cfg, batch.map((chunk) => chunk.text));
      await upsertTurboPufferRows(cfg, namespace, batch, embeddings);
    }
    return { status: "indexed", chunks: chunks.length };
  } catch (error) {
    return {
      status: "failed",
      chunks: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function searchIndex(args: {
  orgId: string;
  repoFullName: string;
  query: string;
  limit?: number;
}): Promise<IndexSearchResult[]> {
  const cfg = indexingConfig();
  if (!cfg) {
    return [];
  }
  const query = args.query.trim();
  if (!query) {
    return [];
  }

  const namespace = namespaceForOrgRepo(args.orgId, args.repoFullName);
  const [vector] = await embedTexts(cfg, [query]);
  const body: Record<string, unknown> = {
    rank_by: ["vector", "ANN", vector],
    limit: Math.min(Math.max(args.limit ?? 8, 1), 50),
    include_attributes: true,
    filters: ["repo_full_name", "Eq", args.repoFullName],
  };

  const response = await fetchImpl(namespaceURL(cfg, namespace, "query"), {
    method: "POST",
    headers: turboPufferHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `query turbopuffer rows: status ${response.status}${text ? ` ${text.slice(0, 500)}` : ""}`,
    );
  }

  const decoded = (await response.json()) as { rows?: unknown[] };
  return (decoded.rows ?? []).flatMap((row) => {
    if (!isRecord(row)) return [];
    const sourceAttributes = isRecord(row.attributes) ? row.attributes : row;
    const { vector: _vector, ...attributes } = sourceAttributes;
    const text = typeof attributes.text === "string" ? attributes.text : "";
    return [{
      id: typeof row.id === "string" ? row.id : "",
      score: typeof row.$dist === "number" ? row.$dist : undefined,
      text,
      attributes,
    }];
  });
}

export async function searchCodeReviewHistory(args: {
  orgId: string;
  repoFullName: string;
  query: string;
  limit?: number;
}): Promise<IndexSearchResult[]> {
  const rows = await searchIndex({
    orgId: args.orgId,
    repoFullName: args.repoFullName,
    query: args.query,
    limit: Math.min(Math.max(args.limit ?? 8, 1), 50),
  });
  return rows.filter((row) => {
    const kind = typeof row.attributes.source_kind === "string" ? row.attributes.source_kind : "";
    return kind === "code_review_history" || kind === "code_review_summary";
  });
}

function buildCodeReviewHistoryChunks(input: CodeReviewHistoryIndexInput): IndexChunk[] {
  const chunks: IndexChunk[] = [];
  const common = {
    org_id: input.orgId,
    repo_full_name: input.repoFullName,
    branch_name: input.branchName ?? "",
    head_sha: input.headSha ?? "",
    event_id: input.runId,
    session_id: "",
    indexed_reason: "code_review_history",
  };

  const summaryText = limitBytes(
    [
      "GX code review summary.",
      `Repo: ${input.repoFullName}`,
      input.branchName ? `Branch: ${input.branchName}` : "",
      input.headSha ? `Head: ${input.headSha}` : "",
      input.scope ? `Scope: ${input.scope}` : "",
      input.mode ? `Mode: ${input.mode}` : "",
      input.reviewer ? `Reviewer: ${input.reviewer}` : "",
      input.prompt ? `Intent: ${input.prompt}` : "",
      input.summaryText,
    ].filter(Boolean).join("\n"),
    maxChunkBytes,
  );
  if (summaryText.trim()) {
    chunks.push(
      chunk("code-review-summary", [input.orgId, input.runId, input.summaryId], summaryText, {
        ...common,
        source_kind: "code_review_summary",
        file: "",
        review_run_id: input.runId,
        review_summary_id: input.summaryId,
        review_scope: input.scope ?? "",
        review_mode: input.mode ?? "",
        text: summaryText,
      }),
    );
  }

  for (const finding of input.findings) {
    const text = limitBytes(
      [
        "GX code review finding history.",
        `Repo: ${input.repoFullName}`,
        input.branchName ? `Branch: ${input.branchName}` : "",
        input.headSha ? `Head: ${input.headSha}` : "",
        `Outcome: ${finding.outcome}`,
        `Category: ${finding.category}`,
        finding.language ? `Language: ${finding.language}` : "",
        finding.filePath ? `File: ${finding.filePath}` : "",
        finding.lineStart ? `Line: ${finding.lineStart}` : "",
        finding.severity ? `Severity: ${finding.severity}` : "",
        typeof finding.confidence === "number" ? `Confidence: ${finding.confidence}` : "",
        `Title: ${finding.title}`,
        `Summary: ${finding.summary}`,
        finding.recommendation ? `Recommendation: ${finding.recommendation}` : "",
      ].filter(Boolean).join("\n"),
      maxChunkBytes,
    );
    chunks.push(
      chunk(
        "code-review-finding",
        [input.orgId, input.runId, finding.id || finding.fingerprint || finding.title],
        text,
        {
          ...common,
          source_kind: "code_review_history",
          file: finding.filePath ?? "",
          review_run_id: input.runId,
          review_finding_id: finding.id,
          review_fingerprint: finding.fingerprint,
          review_outcome: finding.outcome,
          review_category: finding.category,
          review_language: finding.language ?? "",
          line_start: finding.lineStart ?? 0,
          line_end: finding.lineEnd ?? finding.lineStart ?? 0,
          text,
        },
      ),
    );
  }

  return chunks;
}

function buildPublishedArtifactChunks(input: PublishArtifactIndexInput): IndexChunk[] {
  const chunks: IndexChunk[] = [];
  const stack = Array.isArray(input.payload.stack) ? input.payload.stack : [];
  stack.forEach((revision, index) => {
    const change = isRecord(revision.change) ? revision.change : {};
    const files = stringArray(change.files);
    const patch = typeof revision.patch === "string" ? revision.patch : "";
    const description =
      typeof change.description === "string" ? change.description.trim() : "";
    if (!patch && !description && files.length === 0) {
      return;
    }
    const branchName =
      typeof revision.branch_name === "string" && revision.branch_name.trim()
        ? revision.branch_name.trim()
        : input.branchName;
    const baseBranchName =
      typeof revision.base_branch_name === "string"
        ? revision.base_branch_name.trim()
        : "";
    const text = limitBytes(
      [
        "GX published revision diff.",
        `Repo: ${input.repoFullName}`,
        `Branch: ${branchName}`,
        baseBranchName ? `Base: ${baseBranchName}` : "",
        `Head: ${input.headSha}`,
        description ? `Description: ${description}` : "",
        files.length ? `Files:\n${files.join("\n")}` : "",
        patch ? `Patch:\n${patch}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      maxChunkBytes,
    );
    chunks.push(
      chunk(
        "published-revision",
        [input.orgId, input.eventId, String(index), branchName],
        text,
        {
          org_id: input.orgId,
          repo_full_name: input.repoFullName,
          branch_name: branchName,
          source_kind: "published_revision_diff",
          file: files[0] ?? "",
          session_id: "",
          head_sha: input.headSha,
          indexed_reason: "gx_pr_artifact",
          event_id: input.eventId,
          text,
        },
      ),
    );
  });

  const sessions = Array.isArray(input.payload.sessions) ? input.payload.sessions : [];
  sessions.slice(0, 20).forEach((session, index) => {
    if (!isRecord(session)) return;
    const sessionId = typeof session.id === "string" ? session.id : "";
    const command = typeof session.command === "string" ? session.command : "";
    const cwd = typeof session.cwd === "string" ? session.cwd : "";
    const requests = Array.isArray(session.requests) ? session.requests : [];
    if (!sessionId && !command && requests.length === 0) {
      return;
    }
    const text = limitBytes(
      [
        "GX published session context.",
        `Repo: ${input.repoFullName}`,
        `Branch: ${input.branchName}`,
        `Head: ${input.headSha}`,
        sessionId ? `Session: ${sessionId}` : "",
        command ? `Command: ${command}` : "",
        cwd ? `Cwd: ${cwd}` : "",
        `Requests: ${requests.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
      maxChunkBytes,
    );
    chunks.push(
      chunk("published-session", [input.orgId, input.eventId, sessionId, String(index)], text, {
        org_id: input.orgId,
        repo_full_name: input.repoFullName,
        branch_name: input.branchName,
        source_kind: "published_session_context",
        file: "",
        session_id: sessionId,
        head_sha: input.headSha,
        indexed_reason: "gx_pr_artifact",
        event_id: input.eventId,
        text,
      }),
    );
  });

  return chunks;
}

async function buildIncrementalChunks(
  db: postgres.Sql,
  input: PushIndexInput,
): Promise<IndexChunk[]> {
  const common = {
    org_id: input.orgId,
    repo_full_name: input.repoFullName,
    branch_name: branchFromRef(input.ref),
    source_kind: "push_delta",
    indexed_reason: input.reason,
    head_sha: input.afterSha ?? "",
  };

  const pushText = limitBytes(
    [
      "GX incremental index push event.",
      `Repo: ${input.repoFullName}`,
      `Ref: ${input.ref ?? ""}`,
      `Head: ${input.afterSha ?? ""}`,
      `Reason: ${input.reason}`,
      input.commitMessages?.length
        ? `Commits:\n${input.commitMessages.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    maxChunkBytes,
  );

  const chunks: IndexChunk[] = [
    chunk("push", [input.orgId, input.repoFullName, input.afterSha ?? input.reason], pushText, {
      ...common,
      text: pushText,
    }),
  ];

  const hunkRows = await db<{
    file: string;
    line_start: number;
    line_end: number;
    session_id: string;
    tool: string | null;
    model: string | null;
  }[]>`
    SELECT hl.file, hl.line_start, hl.line_end, hl.session_id, hl.tool, hl.model
    FROM hunk_links hl
    JOIN pr_events pe ON pe.id = hl.event_id
    JOIN bookmarks b ON b.latest_event_id = pe.id
    WHERE hl.org_id = ${input.orgId}
      AND b.repo_full_name = ${input.repoFullName}
    ORDER BY pe.created_at_ms DESC
    LIMIT 50
  `;

  for (const row of hunkRows) {
    const text = limitBytes(
      [
        "GX hunk link for review context.",
        `Repo: ${input.repoFullName}`,
        `File: ${row.file}`,
        `Lines: ${row.line_start}-${row.line_end}`,
        `Session: ${row.session_id}`,
        row.tool ? `Tool: ${row.tool}` : "",
        row.model ? `Model: ${row.model}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      maxChunkBytes,
    );
    chunks.push(
      chunk(
        "hunk",
        [input.orgId, row.file, String(row.line_start), row.session_id],
        text,
        {
          ...common,
          source_kind: "hunk_link",
          file: row.file,
          line_start: row.line_start,
          line_end: row.line_end,
          session_id: row.session_id,
          tool: row.tool ?? "",
          model: row.model ?? "",
          text,
        },
      ),
    );
  }

  return chunks;
}

async function embedTexts(cfg: IndexingConfig, inputs: string[]): Promise<number[][]> {
  const response = await fetchImpl(`${cfg.openAIBaseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.openAIAPIKey}`,
    },
    body: JSON.stringify({
      model: openAIEmbeddingModel,
      input: inputs,
      encoding_format: "float",
      dimensions: embeddingDimensions,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `request OpenAI embeddings: status ${response.status}${body ? ` ${body.slice(0, 500)}` : ""}`,
    );
  }
  const decoded = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
  };
  const out = new Array<number[]>(inputs.length);
  for (const item of decoded.data ?? []) {
    out[item.index] = item.embedding;
  }
  if (out.some((embedding) => !Array.isArray(embedding))) {
    throw new Error("OpenAI embeddings response did not include every input");
  }
  return out;
}

async function upsertTurboPufferRows(
  cfg: IndexingConfig,
  namespace: string,
  chunks: IndexChunk[],
  embeddings: number[][],
): Promise<void> {
  const upsertRows = chunks.map((chunk, index) => ({
    id: chunk.id,
    vector: embeddings[index],
    ...chunk.attributes,
    text: chunk.text,
  }));
  const response = await fetchImpl(namespaceURL(cfg, namespace), {
    method: "POST",
    headers: turboPufferHeaders(cfg),
    body: JSON.stringify({
      distance_metric: "cosine_distance",
      schema: turboPufferSchema(),
      upsert_rows: upsertRows,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `upsert turbopuffer rows: status ${response.status}${body ? ` ${body.slice(0, 500)}` : ""}`,
    );
  }
}

function turboPufferHeaders(cfg: IndexingConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.turboPufferAPIKey}`,
    "Content-Type": "application/json",
  };
}

function namespaceURL(cfg: IndexingConfig, namespace: string, suffix = ""): string {
  const base = `${cfg.turboPufferBaseURL}/v2/namespaces/${namespace}`;
  return suffix ? `${base}/${suffix}` : base;
}

function turboPufferSchema(): Record<string, unknown> {
  const filterableString = { type: "string", filterable: true };
  return {
    vector: { type: `[${embeddingDimensions}]f32`, ann: true },
    text: { type: "string", full_text_search: true },
    org_id: filterableString,
    repo_full_name: filterableString,
    branch_name: filterableString,
    source_kind: filterableString,
    file: filterableString,
    session_id: filterableString,
    head_sha: filterableString,
    event_id: filterableString,
    indexed_reason: filterableString,
  };
}

function chunk(
  kind: string,
  parts: string[],
  text: string,
  attributes: Record<string, unknown>,
): IndexChunk {
  const id = `gx-${kind}-${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 40)}`;
  return { id, text, attributes };
}

function branchFromRef(ref?: string): string {
  if (!ref) return "";
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function limitBytes(text: string, maxBytes: number): string {
  const encoded = Buffer.byteLength(text, "utf8");
  if (encoded <= maxBytes) {
    return text;
  }
  return Buffer.from(text, "utf8").subarray(0, maxBytes - 14).toString("utf8") + "\n[truncated]\n";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
