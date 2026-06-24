import type postgres from "postgres";
import { createLLMProvider, type LLMProvider } from "../llm/provider";
import {
  checkPrSummaryQuota,
  QuotaExceededError,
  recordPrSummaryUsage,
} from "../metering/quota";
import { capture, Events } from "../telemetry/posthog";
import {
  buildPRSummaryUserPrompt,
  PR_SUMMARY_SYSTEM_PROMPT,
} from "../llm/prompts/pr-summary";
import { searchIndex } from "../indexing/turbopuffer";
import { assertValidSummary, validateSummary } from "./validate";

export type HunkLinkRow = {
  file: string;
  lineStart: number;
  lineEnd: number;
  sessionId: string;
  matchTier: number;
  confidence: number;
  authorship: string;
  tool: string | null;
  model: string | null;
};

export type SessionEventRow = {
  sessionId: string;
  eventType: string;
  filePath: string | null;
  rawLine: number;
  tool: string;
  model: string | null;
};

export type ChangedSymbolRow = {
  file: string;
  symbol: string;
  kind?: string;
  startLine?: number;
  endLine?: number;
};

export type FileSurfaceRow = {
  file: string;
  category: string;
  reason: string;
};

export type IndexSnippetRow = {
  id: string;
  text: string;
  score?: number;
  sourceKind?: string;
};

export type PublishedRevisionRow = {
  branchName: string | null;
  baseBranchName: string | null;
  description: string | null;
  files: string[];
  patch: string;
  githubPrUrl: string | null;
};

export type PublishedSessionRow = {
  sessionId: string;
  command: string | null;
  cwd: string | null;
  requestCount: number;
  responseCount: number;
};

export type ExtractContext = {
  eventId: string;
  bookmarkId: string;
  orgId: string;
  repoRootPath: string | null;
  headCommitId: string | null;
  refRange: string | null;
  fileStats: unknown;
  intentCandidates: unknown[];
  struggleSignals: unknown[];
  humanOverrides: unknown[];
  hunkLinks: HunkLinkRow[];
  sessionEvents: SessionEventRow[];
  publishedRevisions?: PublishedRevisionRow[];
  publishedSessions?: PublishedSessionRow[];
  changedSymbols?: ChangedSymbolRow[];
  fileSurfaces?: FileSurfaceRow[];
  indexSnippets?: IndexSnippetRow[];
};

export type GenerateSummaryInput = {
  orgId: string;
  userId?: string;
  bookmarkId?: string;
  eventId?: string;
  provider?: LLMProvider;
  skipQuotaCheck?: boolean;
};

export type GenerateSummaryResult = {
  summaryId: string;
  bookmarkId: string;
  eventId: string;
  content: string;
  model: string;
  latencyMs: number;
  lineCount: number;
};

type PrEventPayload = {
  refRange?: string;
  intentCandidates?: unknown[];
  struggleSignals?: unknown[];
  humanOverrides?: unknown[];
  fileStats?: unknown;
  toolVersions?: Record<string, string>;
  stack?: unknown[];
  change?: unknown;
  sessions?: unknown[];
};

type ResolvedTarget = {
  bookmarkId: string;
  eventId: string;
};

type BookmarkTargetRow = {
  id: string;
  latest_event_id: string | null;
  head_commit_id: string | null;
  remote_head_sha: string | null;
};

export async function resolveSummaryTarget(
  db: postgres.Sql,
  orgId: string,
  input: Pick<GenerateSummaryInput, "bookmarkId" | "eventId">,
): Promise<ResolvedTarget> {
  if (!input.bookmarkId && !input.eventId) {
    throw new Error("bookmarkId or eventId is required");
  }

  if (input.bookmarkId && input.eventId) {
    const [bookmark] = await db<BookmarkTargetRow[]>`
      SELECT id, latest_event_id, head_commit_id, remote_head_sha
      FROM bookmarks
      WHERE id = ${input.bookmarkId} AND org_id = ${orgId}
    `;
    if (!bookmark) {
      throw new Error("bookmark not found");
    }
    if (bookmark.latest_event_id !== input.eventId) {
      throw new Error("bookmarkId does not match eventId");
    }
    return { bookmarkId: bookmark.id, eventId: input.eventId };
  }

  if (input.bookmarkId) {
    const [bookmark] = await db<BookmarkTargetRow[]>`
      SELECT id, latest_event_id, head_commit_id, remote_head_sha
      FROM bookmarks
      WHERE id = ${input.bookmarkId} AND org_id = ${orgId}
    `;
    if (!bookmark) {
      throw new Error("bookmark not found");
    }
    const eventId = await resolveEventForBookmark(db, orgId, bookmark);
    if (!eventId) {
      throw new Error("bookmark not found or has no matching review event");
    }
    return { bookmarkId: bookmark.id, eventId };
  }

  const eventId = input.eventId!;
  const [event] = await db<{ id: string }[]>`
    SELECT id FROM pr_events WHERE id = ${eventId} AND org_id = ${orgId}
  `;
  if (!event) {
    throw new Error("event not found");
  }

  const [bookmark] = await db<{ id: string }[]>`
    SELECT id FROM bookmarks
    WHERE org_id = ${orgId} AND latest_event_id = ${eventId}
    ORDER BY updated_at_ms DESC
    LIMIT 1
  `;
  if (!bookmark) {
    throw new Error("no bookmark linked to eventId");
  }

  return { bookmarkId: bookmark.id, eventId };
}

async function resolveEventForBookmark(
  db: postgres.Sql,
  orgId: string,
  bookmark: BookmarkTargetRow,
): Promise<string | null> {
  const headShas = [
    bookmark.head_commit_id?.trim(),
    bookmark.remote_head_sha?.trim(),
  ].filter((value, index, values): value is string =>
    Boolean(value) && values.indexOf(value) === index,
  );

  if (bookmark.latest_event_id) {
    const [latestEvent] = await db<{ id: string }[]>`
      SELECT id
      FROM pr_events
      WHERE org_id = ${orgId}
        AND id = ${bookmark.latest_event_id}
        AND (
          ${headShas.length} = 0
          OR head_commit_id = ANY(${headShas})
        )
      LIMIT 1
    `;
    if (latestEvent?.id) {
      return latestEvent.id;
    }
  }

  if (headShas.length > 0) {
    const [event] = await db<{ id: string }[]>`
      SELECT id
      FROM pr_events
      WHERE org_id = ${orgId}
        AND head_commit_id = ANY(${headShas})
      ORDER BY
        CASE
          WHEN jsonb_typeof(payload->'stack') = 'array'
            AND jsonb_array_length(payload->'stack') > 0
            THEN 3
          WHEN payload ? 'change'
            THEN 2
          WHEN EXISTS (
            SELECT 1
            FROM hunk_links
            WHERE hunk_links.org_id = ${orgId}
              AND hunk_links.event_id = pr_events.id
          )
            THEN 1
          ELSE 0
        END DESC,
        created_at_ms DESC
      LIMIT 1
    `;
    if (event?.id) {
      return event.id;
    }
  }

  return bookmark.latest_event_id;
}

export async function loadExtractContext(
  db: postgres.Sql,
  orgId: string,
  target: ResolvedTarget,
): Promise<ExtractContext> {
  const [event] = await db<{
    repo_root_path: string | null;
    head_commit_id: string | null;
    payload: unknown;
  }[]>`
    SELECT repo_root_path, head_commit_id, payload
    FROM pr_events
    WHERE id = ${target.eventId} AND org_id = ${orgId}
  `;
  if (!event) {
    throw new Error("event not found");
  }

  const payload = normalizePrEventPayload(event.payload);
  const hunkRows = await db<{
    file: string;
    line_start: number;
    line_end: number;
    session_id: string;
    match_tier: number;
    confidence: number;
    authorship: string;
    tool: string | null;
    model: string | null;
  }[]>`
    SELECT file, line_start, line_end, session_id, match_tier, confidence, authorship, tool, model
    FROM hunk_links
    WHERE org_id = ${orgId} AND event_id = ${target.eventId}
    ORDER BY file, line_start
  `;

  const sessionIds = [...new Set(hunkRows.map((row) => row.session_id).filter(Boolean))];
  let sessionEvents: SessionEventRow[] = [];
  if (sessionIds.length > 0) {
    sessionEvents = await db<{
      session_id: string;
      event_type: string;
      file_path: string | null;
      raw_line: number;
      tool: string;
      model: string | null;
    }[]>`
      SELECT session_id, event_type, file_path, raw_line, tool, model
      FROM session_events
      WHERE org_id = ${orgId} AND session_id = ANY(${sessionIds})
      ORDER BY ts ASC
      LIMIT 200
    `.then((rows) =>
      rows.map((row) => ({
        sessionId: row.session_id,
        eventType: row.event_type,
        filePath: row.file_path,
        rawLine: row.raw_line,
        tool: row.tool,
        model: row.model,
      })),
    );
  }

  const publishedRevisions = extractPublishedRevisions(payload);
  const publishedSessions = extractPublishedSessions(payload);
  const changedSymbols = extractChangedSymbols(payload);
  const fileSurfaces = extractFileSurfaces(payload);
  const indexSnippets = await loadIndexSnippets(db, orgId, target.bookmarkId, {
    headCommitId: event.head_commit_id,
    repoRootPath: event.repo_root_path,
    payload,
    hunkRows,
    publishedRevisions,
    changedSymbols,
  });

  return {
    eventId: target.eventId,
    bookmarkId: target.bookmarkId,
    orgId,
    repoRootPath: event.repo_root_path,
    headCommitId: event.head_commit_id,
    refRange: payload.refRange ?? null,
    fileStats: payload.fileStats ?? null,
    intentCandidates: payload.intentCandidates ?? [],
    struggleSignals: payload.struggleSignals ?? [],
    humanOverrides: payload.humanOverrides ?? [],
    hunkLinks: hunkRows.map((row) => ({
      file: row.file,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      sessionId: row.session_id,
      matchTier: row.match_tier,
      confidence: row.confidence,
      authorship: row.authorship,
      tool: row.tool,
      model: row.model,
    })),
    sessionEvents,
    publishedRevisions,
    publishedSessions,
    changedSymbols,
    fileSurfaces,
    indexSnippets,
  };
}

async function loadIndexSnippets(
  db: postgres.Sql,
  orgId: string,
  bookmarkId: string,
  input: {
    headCommitId: string | null;
    repoRootPath: string | null;
    payload: PrEventPayload;
    hunkRows: Array<{ file: string }>;
    publishedRevisions: PublishedRevisionRow[];
    changedSymbols: ChangedSymbolRow[];
  },
): Promise<IndexSnippetRow[]> {
  const [bookmark] = await db<{ repo_full_name: string }[]>`
    SELECT repo_full_name
    FROM bookmarks
    WHERE id = ${bookmarkId} AND org_id = ${orgId}
  `;
  if (!bookmark?.repo_full_name) {
    return [];
  }

  const query = [
    input.repoRootPath,
    input.headCommitId,
    ...input.hunkRows.map((row) => row.file),
    ...input.publishedRevisions.flatMap((revision) => [
      revision.description ?? "",
      ...revision.files,
    ]),
    ...input.changedSymbols.map((symbol) => `${symbol.file} ${symbol.symbol}`),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2_000);

  if (!query.trim()) {
    return [];
  }

  try {
    const hits = await searchIndex({
      orgId,
      repoFullName: bookmark.repo_full_name,
      query,
      limit: 8,
    });
    return hits.map((hit) => ({
      id: hit.id,
      text: hit.text,
      score: hit.score,
      sourceKind:
        typeof hit.attributes.source_kind === "string"
          ? hit.attributes.source_kind
          : undefined,
    }));
  } catch (error) {
    console.info("summary index context unavailable", {
      orgId,
      bookmarkId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function extractPublishedRevisions(payload: PrEventPayload): PublishedRevisionRow[] {
  return arrayRecords(payload.stack)
    .flatMap((entry) => {
      const change = asRecord(entry.change);
      const patch = stringValue(entry.patch);
      const files = stringArray(change?.files);
      if (!patch && files.length === 0 && !stringValue(change?.description)) {
        return [];
      }
      return [
        {
          branchName: stringValue(entry.branch_name) || null,
          baseBranchName: stringValue(entry.base_branch_name) || null,
          description: stringValue(change?.description) || null,
          files,
          patch,
          githubPrUrl: stringValue(entry.github_pull_request_url) || null,
        },
      ];
    })
    .reverse();
}

function normalizePrEventPayload(payload: unknown): PrEventPayload {
  if (typeof payload === "string") {
    try {
      const parsed: unknown = JSON.parse(payload);
      return asRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(payload) ?? {};
}

function extractPublishedSessions(payload: PrEventPayload): PublishedSessionRow[] {
  return arrayRecords(payload.sessions)
    .flatMap((session) => {
      const sessionId = stringValue(session.id);
      if (!sessionId) return [];
      const requests = arrayRecords(session.requests);
      const responseCount = requests.reduce(
        (sum, request) => sum + arrayRecords(request.responses).length,
        0,
      );
      return [
        {
          sessionId,
          command: stringValue(session.command) || null,
          cwd: stringValue(session.cwd) || null,
          requestCount: requests.length,
          responseCount,
        },
      ];
    })
    .slice(0, 20);
}

function extractChangedSymbols(payload: PrEventPayload): ChangedSymbolRow[] {
  const revisions = [
    ...arrayRecords(payload.stack).map((entry) => asRecord(entry.change)),
    asRecord(payload.change),
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  const seen = new Set<string>();
  const rows: ChangedSymbolRow[] = [];
  for (const revision of revisions) {
    const context = asRecord(revision.review_context);
    for (const symbol of arrayRecords(context?.changed_symbols)) {
      const file = stringValue(symbol.file);
      const name = stringValue(symbol.symbol);
      if (!file || !name) continue;
      const key = `${file}\0${name}\0${numberValue(symbol.start_line) ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        file,
        symbol: name,
        kind: stringValue(symbol.kind) || undefined,
        startLine: numberValue(symbol.start_line),
        endLine: numberValue(symbol.end_line),
      });
    }
  }
  return rows.slice(0, 50);
}

function extractFileSurfaces(payload: PrEventPayload): FileSurfaceRow[] {
  const surfaces: FileSurfaceRow[] = [];
  const seen = new Set<string>();
  for (const revision of arrayRecords(payload.stack).map((entry) => asRecord(entry.change))) {
    const context = asRecord(revision?.review_context);
    for (const fact of arrayRecords(context?.structural_facts)) {
      const file = stringValue(fact.file);
      if (!file || seen.has(file)) continue;
      seen.add(file);
      const language = stringValue(fact.language);
      const symbols = stringArray(fact.defined_symbols).slice(0, 5).join(", ");
      surfaces.push({
        file,
        category: language || "source",
        reason: symbols ? `defines ${symbols}` : "included in GX structural context",
      });
    }
  }
  return surfaces.slice(0, 50);
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function generateSummary(
  db: postgres.Sql,
  input: GenerateSummaryInput,
): Promise<GenerateSummaryResult> {
  const target = await resolveSummaryTarget(db, input.orgId, input);
  if (!input.skipQuotaCheck) {
    const quota = await checkPrSummaryQuota(db, input.orgId, target.bookmarkId);
    if (!quota.allowed) {
      capture(
        Events.SummaryQuotaBlocked,
        {
          bookmark_id: target.bookmarkId,
          event_id: target.eventId,
          used: quota.used,
          limit: quota.limit,
        },
        input.orgId,
      );
      throw new QuotaExceededError(quota);
    }
  }
  const ctx = await loadExtractContext(db, input.orgId, target);
  const contextHint =
    ctx.intentCandidates.length > 0
      ? JSON.stringify(ctx.intentCandidates[0])
      : ctx.hunkLinks.map((h) => h.file).slice(0, 3).join(", ");

  const provider = input.provider ?? createLLMProvider(contextHint);
  const startedAt = Date.now();

  const completion = await provider.complete(
    PR_SUMMARY_SYSTEM_PROMPT,
    buildPRSummaryUserPrompt(ctx),
  );

  let content = completion.text;
  let validation = validateSummary(content);
  if (!validation.ok) {
    console.info("PR Summary provider output invalid; using fallback summary", {
      orgId: input.orgId,
      bookmarkId: target.bookmarkId,
      eventId: target.eventId,
      error: validation.error,
      detail: validation.detail,
    });
    content = buildFallbackSummary(ctx);
    validation = validateSummary(content);
    if (!validation.ok) {
      assertValidSummary(content);
    }
  }
  const lineCount = validation.ok ? validation.lineCount : 0;

  const postedAt = Date.now();
  const latencyMs = postedAt - startedAt;

  const [summary] = await db<{ id: string }[]>`
    INSERT INTO summaries (
      org_id, bookmark_id, content, model, latency_ms, posted_at_ms
    ) VALUES (
      ${input.orgId},
      ${target.bookmarkId},
      ${content},
      ${completion.model},
      ${latencyMs},
      ${postedAt}
    )
    RETURNING id
  `;

  await db`
    INSERT INTO summary_events (
      org_id, summary_id, kind, actor, created_at_ms
    ) VALUES (
      ${input.orgId},
      ${summary.id},
      'view',
      'system',
      ${postedAt}
    )
  `;

  await recordPrSummaryUsage(db, {
    orgId: input.orgId,
    userId: input.userId ?? "system",
    bookmarkId: target.bookmarkId,
    eventId: target.eventId,
  });

  capture(
    Events.SummaryGenerated,
    {
      summary_id: summary.id,
      bookmark_id: target.bookmarkId,
      event_id: target.eventId,
      model: completion.model,
      latency_ms: latencyMs,
      line_count: lineCount,
    },
    input.orgId,
  );

  return {
    summaryId: summary.id,
    bookmarkId: target.bookmarkId,
    eventId: target.eventId,
    content,
    model: completion.model,
    latencyMs,
    lineCount,
  };
}

export function buildFallbackSummary(ctx: ExtractContext): string {
  const files = [
    ...(ctx.publishedRevisions ?? []).flatMap((revision) => revision.files),
    ...ctx.hunkLinks.map((hunk) => hunk.file),
    ...(ctx.changedSymbols ?? []).map((symbol) => symbol.file),
  ];
  const uniqueFiles = [...new Set(files.filter(Boolean))];
  const primaryFiles = uniqueFiles.slice(0, 3);
  const firstRevision = ctx.publishedRevisions?.[0];
  const intent =
    firstRevision?.description ||
    (primaryFiles.length ? `Update ${primaryFiles.join(", ")}` : "Update pull request changes");
  const provenance = firstRevision
    ? "GX published revision diff"
    : ctx.hunkLinks.length > 0
      ? "GX hunk_links and session_events"
      : "GitHub webhook context";

  return [
    "Intent",
    intent.slice(0, 160),
    "Read these",
    primaryFiles.length ? `- ${primaryFiles.join(", ")}` : "- Pull request diff",
    "Safe to skim",
    uniqueFiles.length > 3 ? `- ${uniqueFiles.length - 3} additional changed files` : "- No extra files",
    "Blast radius",
    primaryFiles.every((file) => file.toLowerCase().endsWith(".md"))
      ? "- Documentation only"
      : "- Limited to changed PR files",
    "Agent friction",
    "- Fallback summary after invalid model output",
    "Provenance",
    `- ${provenance}`,
  ].join("\n");
}
