import { createHash } from "node:crypto";
import type postgres from "postgres";
import {
  embeddingDimensions,
  indexingConfig,
  namespaceForOrgRepo,
  primaryEmbeddingProfile,
  type EmbeddingProfile,
  type IndexingConfig,
} from "./config";
// openAIEmbeddingModel is intentionally not imported: every embed call now goes
// through an EmbeddingProfile so the model and width always travel together.
import { publishRevisions } from "../publish/revisions";
import type { PushBundle } from "../types";

// Byte budget for one embedded chunk. Diffs are split into per-file parts
// rather than truncated at this cap (see splitPatchIntoParts), so it bounds a
// single embedding input instead of bounding how much of a revision is
// searchable at all.
const maxChunkBytes = 8_000;
/**
 * Ceiling on a published-revision chunk header, so it can never consume the
 * chunk it is supposed to label. Leaves ~5 KB for diff text in every chunk.
 */
const maxHeaderBytes = 3_000;
/** How many paths to name before the file list is summarised as a count. */
const maxHeaderFiles = 40;
/** Smallest patch budget worth splitting against; below this, refuse. */
const patchBudgetFloor = 1_000;

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
  /**
   * Transcript text per session id, loaded from sessions_raw by the publish
   * route. The bundle itself carries only session metadata — the transcript
   * travels through POST /v1/sessions — so without this map the session
   * chunks have no content to embed.
   */
  sessionTexts?: Record<string, { tool?: string; content: string }>;
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

export function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
  publishRevisions(input.payload).forEach((revision, index) => {
    const files = revision.files ?? [];
    const patch = revision.patch ?? "";
    const description = revision.description?.trim() ?? "";
    if (!patch && !description && files.length === 0) {
      return;
    }
    const branchName = revision.branch_name?.trim() || input.branchName;
    const baseBranchName = revision.base_branch_name?.trim() ?? "";
    const header = limitBytes(
      [
        "GX published revision diff.",
        `Repo: ${input.repoFullName}`,
        `Branch: ${branchName}`,
        baseBranchName ? `Base: ${baseBranchName}` : "",
        `Head: ${input.headSha}`,
        description ? `Description: ${description}` : "",
        files.length ? `Files:\n${summariseFileList(files)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      maxHeaderBytes,
    );

    // One chunk per file of the patch, windowed if a single file's diff is
    // still oversized. Previously the entire patch was one chunk hard-truncated
    // at the byte cap, so everything past the first few kilobytes of any real
    // revision was never embedded and never searchable.
    //
    // The header is capped above and measured in bytes here. Uncapped, one
    // commit touching a couple of hundred paths produced a header larger than
    // the whole chunk: the budget went negative, splitPatchIntoParts clamped it
    // to its floor, and limitBytes then cut inside the header — so every chunk
    // was byte-identical, the `Patch:` section was never reached, and the
    // revision's diff was embedded nowhere while publish reported success.
    // `header.length` also counted UTF-16 units against a byte cap, over-
    // budgeting on any non-ASCII path.
    const patchBudget = maxChunkBytes - Buffer.byteLength(header, "utf8") - 32;
    const parts = splitPatchIntoParts(patch, patchBudget);
    const bodies = parts.length > 0 ? parts : [{ file: files[0] ?? "", body: "" }];
    bodies.forEach((part, partIndex) => {
      const text = limitBytes(
        [header, part.body ? `Patch:\n${part.body}` : ""].filter(Boolean).join("\n"),
        maxChunkBytes,
      );
      chunks.push(
        chunk(
          "published-revision",
          [input.orgId, input.eventId, String(index), branchName, String(partIndex)],
          text,
          {
            org_id: input.orgId,
            repo_full_name: input.repoFullName,
            branch_name: branchName,
            source_kind: "published_revision_diff",
            file: part.file || files[0] || "",
            file_path: part.file || files[0] || "",
            session_id: "",
            head_sha: input.headSha,
            indexed_reason: "gx_pr_artifact",
            event_id: input.eventId,
            text,
          },
        ),
      );
    });
  });

  const sessions = Array.isArray(input.payload.sessions) ? input.payload.sessions : [];
  sessions.slice(0, 20).forEach((session, index) => {
    if (!isRecord(session)) return;
    const sessionId = typeof session.id === "string" ? session.id : "";
    const command =
      (typeof session.command === "string" && session.command) ||
      (typeof session.source === "string" && session.source) ||
      "";
    const cwd =
      (typeof session.cwd === "string" && session.cwd) ||
      (typeof session.repo_root === "string" && session.repo_root) ||
      "";
    const requests = Array.isArray(session.requests) ? session.requests : [];
    if (!sessionId && !command && requests.length === 0) {
      return;
    }
    // The bundle's session entries are metadata; the transcript itself arrives
    // through POST /v1/sessions into sessions_raw (the proxy-era requests[]
    // stopped being written when capture went transcript-based). These chunks
    // used to embed only the metadata card below, so the agent-sessions bucket
    // could never answer "why was this written this way" — retrieval returned
    // a header with a request COUNT and nothing a model could reason about.
    const raw = sessionId ? input.sessionTexts?.[sessionId] : undefined;
    const header = limitBytes(
      [
        "GX published session context.",
        `Repo: ${input.repoFullName}`,
        `Branch: ${input.branchName}`,
        `Head: ${input.headSha}`,
        sessionId ? `Session: ${sessionId}` : "",
        command ? `Command: ${command}` : "",
        raw?.tool ? `Tool: ${raw.tool}` : "",
        cwd ? `Cwd: ${cwd}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      maxHeaderBytes,
    );

    const pushSessionChunk = (text: string, part: number) => {
      chunks.push(
        chunk(
          "published-session",
          [input.orgId, input.eventId, sessionId, String(index), String(part)],
          text,
          {
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
          },
        ),
      );
    };

    if (!raw?.content.trim()) {
      pushSessionChunk(header, 0);
      return;
    }

    const budget = maxChunkBytes - Buffer.byteLength(header, "utf8") - 64;
    const windows = splitTextIntoWindows(raw.content, budget);
    const kept = windows.slice(0, maxSessionPartsPerSession);
    kept.forEach((window, part) => {
      const partLabel =
        windows.length > kept.length && part === kept.length - 1
          ? `Transcript part ${part + 1}/${windows.length} (indexing capped at ${maxSessionPartsPerSession} parts)`
          : `Transcript part ${part + 1}/${windows.length}`;
      pushSessionChunk(
        limitBytes([header, partLabel, "", window].join("\n"), maxChunkBytes),
        part,
      );
    });
  });

  return chunks;
}

/**
 * Ceiling on transcript chunks per session. A 1 MB transcript at the ~5 KB
 * chunk budget would otherwise emit ~200 chunks per session; the head of a
 * session (the ask, the plan, the first decisions) carries most of the
 * retrievable signal, so the cap keeps cost bounded and the last kept chunk
 * says the transcript continued.
 */
const maxSessionPartsPerSession = 12;

/**
 * Split plain text into byte-bounded windows on line boundaries. A line longer
 * than the budget is hard-split rather than dropped.
 */
export function splitTextIntoWindows(text: string, maxBytes: number): string[] {
  const budget = Math.max(maxBytes, 512);
  const windows: string[] = [];
  let current = "";
  let currentBytes = 0;
  const push = () => {
    const trimmed = current.trim();
    if (trimmed) windows.push(trimmed);
    current = "";
    currentBytes = 0;
  };
  for (const line of text.split("\n")) {
    let piece = line;
    let pieceBytes = Buffer.byteLength(piece, "utf8");
    while (pieceBytes > budget) {
      push();
      // Hard-split an oversized line: back the character count off until the
      // encoded head fits, so a multi-byte code point is never cut.
      let take = piece.length;
      while (take > 1 && Buffer.byteLength(piece.slice(0, take), "utf8") > budget) {
        take = Math.max(1, Math.floor(take * 0.9));
      }
      windows.push(piece.slice(0, take).trim());
      piece = piece.slice(take);
      pieceBytes = Buffer.byteLength(piece, "utf8");
    }
    if (currentBytes + pieceBytes + 1 > budget) {
      push();
    }
    current += (current ? "\n" : "") + piece;
    currentBytes += pieceBytes + 1;
  }
  push();
  return windows;
}

/**
 * Split a unified diff into indexable parts: one per `diff --git` section, and
 * further into line windows when a single file's diff exceeds the byte budget.
 * Returns the touched path alongside each part so a hit can be attributed to a
 * file rather than to the whole revision.
 */
/**
 * The paths a header names, elided past a cap.
 *
 * A bulk rename or codegen drop can list hundreds of paths, and inlining all of
 * them is what pushed the header past the chunk size. The first N still carry
 * the retrieval signal; the rest become a count.
 */
function summariseFileList(files: string[]): string {
  if (files.length <= maxHeaderFiles) return files.join("\n");
  const shown = files.slice(0, maxHeaderFiles).join("\n");
  return `${shown}\n… and ${files.length - maxHeaderFiles} more file(s)`;
}

export function splitPatchIntoParts(
  patch: string,
  maxBytes: number,
): Array<{ file: string; body: string }> {
  const trimmed = patch.trim();
  if (!trimmed) return [];
  if (maxBytes < patchBudgetFloor) {
    // Clamping a sub-floor budget is what let the caller's arithmetic go
    // negative unnoticed and emit hundreds of identical chunks. Callers must
    // leave room for a patch; refusing here makes the mistake visible.
    throw new Error(
      `splitPatchIntoParts: budget ${maxBytes} is below the ${patchBudgetFloor}-byte floor; the caller left no room for patch text`,
    );
  }
  const budget = maxBytes;

  const sections: Array<{ file: string; body: string }> = [];
  let current: { file: string; lines: string[] } | null = null;
  for (const line of trimmed.split("\n")) {
    const match = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (match) {
      if (current) sections.push({ file: current.file, body: current.lines.join("\n") });
      current = { file: match[2] ?? match[1] ?? "", lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      current = { file: "", lines: [line] };
    }
  }
  if (current) sections.push({ file: current.file, body: current.lines.join("\n") });

  const parts: Array<{ file: string; body: string }> = [];
  for (const section of sections) {
    if (Buffer.byteLength(section.body, "utf8") <= budget) {
      parts.push(section);
      continue;
    }
    let window: string[] = [];
    let size = 0;
    for (const line of section.body.split("\n")) {
      const lineSize = Buffer.byteLength(line, "utf8") + 1;
      if (window.length > 0 && size + lineSize > budget) {
        parts.push({ file: section.file, body: window.join("\n") });
        window = [];
        size = 0;
      }
      window.push(line);
      size += lineSize;
    }
    if (window.length > 0) parts.push({ file: section.file, body: window.join("\n") });
  }
  return parts;
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

export async function embedTexts(
  cfg: IndexingConfig,
  inputs: string[],
  profile: EmbeddingProfile = primaryEmbeddingProfile,
): Promise<number[][]> {
  const response = await fetchImpl(`${cfg.openAIBaseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.openAIAPIKey}`,
    },
    body: JSON.stringify({
      model: profile.model,
      input: inputs,
      encoding_format: "float",
      dimensions: profile.dimensions,
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

export function turboPufferHeaders(cfg: IndexingConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.turboPufferAPIKey}`,
    "Content-Type": "application/json",
  };
}

export function namespaceURL(cfg: IndexingConfig, namespace: string, suffix = ""): string {
  const base = `${cfg.turboPufferBaseURL}/v2/namespaces/${namespace}`;
  return suffix ? `${base}/${suffix}` : base;
}

/**
 * One schema for every row kind in the namespace.
 *
 * Two full-text columns exist on purpose. `text` holds the embedded body and is
 * stemmed, so a query for "retry" reaches a chunk that says "retries". `symbol`
 * holds identifier terms and is NOT stemmed, because identifier lookups must be
 * exact — TurboPuffer's tokenizer does not split camelCase, so sub-word recall
 * comes from the writer storing pre-split word parts in the value (see
 * CodeChunk.SymbolText in the gx CLI), not from the tokenizer.
 *
 * Must stay in sync with transcriptTurboPufferSchema in
 * internal/semantic/transcript_row.go: both processes push a schema on every
 * upsert into the same namespace.
 */
function turboPufferSchema(): Record<string, unknown> {
  const filterableString = { type: "string", filterable: true };
  const filterableUint = { type: "uint", filterable: true };
  return {
    vector: { type: `[${embeddingDimensions}]f32`, ann: true },
    text: {
      type: "string",
      full_text_search: { stemming: true, remove_stopwords: false, case_sensitive: false },
    },
    symbol: {
      type: "string",
      full_text_search: { stemming: false, remove_stopwords: false, case_sensitive: false },
    },
    org_id: filterableString,
    repo_full_name: filterableString,
    repo_root: filterableString,
    branch_name: filterableString,
    source_kind: filterableString,
    source_id: filterableString,
    file: filterableString,
    file_path: filterableString,
    symbol_name: filterableString,
    symbol_kind: filterableString,
    package_name: filterableString,
    language: filterableString,
    doc_type: filterableString,
    chunk_hash: filterableString,
    session_id: filterableString,
    head_sha: filterableString,
    commit_id: filterableString,
    event_id: filterableString,
    indexed_reason: filterableString,
    tool: filterableString,
    model: filterableString,
    review_run_id: filterableString,
    review_summary_id: filterableString,
    review_finding_id: filterableString,
    review_fingerprint: filterableString,
    review_outcome: filterableString,
    review_category: filterableString,
    review_language: filterableString,
    review_scope: filterableString,
    review_mode: filterableString,
    start_line: filterableUint,
    end_line: filterableUint,
    line_start: filterableUint,
    line_end: filterableUint,
    indexed_at: { type: "uint" },
    created_at: { type: "uint" },
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
