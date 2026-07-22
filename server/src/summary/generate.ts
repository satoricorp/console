import type postgres from "postgres";
import { attachBrokerContext } from "../context/attach";
import { createLLMProvider, type LLMProvider } from "../llm/provider";
import {
  recordGithubPostSkip,
  type GithubPostSkipSource,
} from "../metering/github-post-skips";
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
import {
  enrichSummaryLinks,
  type SummaryLinkContext,
} from "./enrich-links";
import { enrichSeverityDots } from "./severity";
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
  bucket?: string;
  /** Repo-relative path when the snippet is file-backed. */
  file?: string;
};

export type PublishedRevisionRow = {
  branchName: string | null;
  baseBranchName: string | null;
  description: string | null;
  files: string[];
  patch: string | null;
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
  githubPrUrl: string | null;
  refRange: string | null;
  fileStats: unknown;
  intentCandidates: unknown[];
  struggleSignals: unknown[];
  humanOverrides: unknown[];
  hunkLinks: HunkLinkRow[];
  sessionEvents: SessionEventRow[];
  changedSymbols?: ChangedSymbolRow[];
  fileSurfaces?: FileSurfaceRow[];
  indexSnippets?: IndexSnippetRow[];
  publishedRevisions?: PublishedRevisionRow[];
  publishedSessions?: PublishedSessionRow[];
};

export type GenerateSummaryInput = {
  orgId: string;
  userId?: string;
  bookmarkId?: string;
  eventId?: string;
  provider?: LLMProvider;
  skipQuotaCheck?: boolean;
  /** Where to attribute a quota skip row when posting is blocked. */
  quotaSkipSource?: GithubPostSkipSource;
  quotaSkipPrNumber?: number | null;
  quotaSkipRepoFullName?: string | null;
  /** Prefer this PR URL when bookmark row is missing github_pr_url. */
  githubPrUrl?: string | null;
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
  // gx.pr artifact shape (see PushBundle)
  event?: string;
  stack?: Array<{
    branch_name?: string;
    base_branch_name?: string;
    patch?: string;
    github_pull_request_url?: string;
    change?: {
      description?: string;
      files?: string[];
    };
  }>;
  change?: {
    description?: string;
    files?: string[];
  };
  sessions?: Array<{
    id?: string;
    command?: string;
    cwd?: string;
    requests?: unknown[];
  }>;
};

type ResolvedTarget = {
  bookmarkId: string;
  eventId: string;
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
    const [bookmark] = await db<{ id: string; latest_event_id: string | null }[]>`
      SELECT id, latest_event_id
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
    const [bookmark] = await db<{ id: string; latest_event_id: string | null }[]>`
      SELECT id, latest_event_id
      FROM bookmarks
      WHERE id = ${input.bookmarkId} AND org_id = ${orgId}
    `;
    if (!bookmark?.latest_event_id) {
      throw new Error("bookmark not found or has no latest_event_id");
    }
    return { bookmarkId: bookmark.id, eventId: bookmark.latest_event_id };
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

export async function loadExtractContext(
  db: postgres.Sql,
  orgId: string,
  target: ResolvedTarget,
): Promise<ExtractContext> {
  const [event] = await db<{
    repo_root_path: string | null;
    head_commit_id: string | null;
    payload: PrEventPayload;
  }[]>`
    SELECT repo_root_path, head_commit_id, payload
    FROM pr_events
    WHERE id = ${target.eventId} AND org_id = ${orgId}
  `;
  if (!event) {
    throw new Error("event not found");
  }

  const payload = event.payload ?? {};
  let hunkRows = await db<{
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
  if (hunkRows.length === 0 && event.head_commit_id) {
    // gx.pr artifact events carry no hunk_links of their own; the capture
    // extract for the same head commit is a sibling pr_event.
    hunkRows = await db<typeof hunkRows>`
      SELECT hl.file, hl.line_start, hl.line_end, hl.session_id, hl.match_tier,
             hl.confidence, hl.authorship, hl.tool, hl.model
      FROM hunk_links hl
      JOIN pr_events pe ON pe.id = hl.event_id
      WHERE hl.org_id = ${orgId}
        AND pe.head_commit_id = ${event.head_commit_id}
      ORDER BY hl.file, hl.line_start
      LIMIT 200
    `;
  }

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

  let indexSnippets: IndexSnippetRow[] | undefined;
  const [bookmarkMeta] = await db<{
    repo_full_name: string;
    branch_name: string;
    github_pr_url: string | null;
  }[]>`
    SELECT repo_full_name, branch_name, github_pr_url
    FROM bookmarks
    WHERE id = ${target.bookmarkId} AND org_id = ${orgId}
  `;
  if (bookmarkMeta?.repo_full_name) {
    try {
      const attached = await attachBrokerContext(db, {
        orgId,
        repoFullName: bookmarkMeta.repo_full_name,
        changedFiles: hunkRows.map((h) => h.file),
        branch: bookmarkMeta.branch_name,
        headSha: event.head_commit_id ?? undefined,
      });
      if (attached.indexSnippets.length > 0) {
        indexSnippets = attached.indexSnippets;
      }
    } catch {
      // fail open
    }
  }

  return {
    eventId: target.eventId,
    bookmarkId: target.bookmarkId,
    orgId,
    repoRootPath: event.repo_root_path,
    headCommitId: event.head_commit_id,
    githubPrUrl: bookmarkMeta?.github_pr_url ?? null,
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
    indexSnippets,
    publishedRevisions: publishedRevisionsFromPayload(payload),
    publishedSessions: publishedSessionsFromPayload(payload),
  };
}

function publishedRevisionsFromPayload(
  payload: PrEventPayload,
): PublishedRevisionRow[] {
  const stack = Array.isArray(payload.stack) ? payload.stack : [];
  const revisions: PublishedRevisionRow[] = stack.map((entry) => ({
    branchName: entry.branch_name ?? null,
    baseBranchName: entry.base_branch_name ?? null,
    description: entry.change?.description ?? null,
    files: Array.isArray(entry.change?.files) ? entry.change.files : [],
    patch: typeof entry.patch === "string" && entry.patch ? entry.patch : null,
    githubPrUrl: entry.github_pull_request_url ?? null,
  }));
  if (revisions.length === 0 && payload.change) {
    revisions.push({
      branchName: null,
      baseBranchName: null,
      description: payload.change.description ?? null,
      files: Array.isArray(payload.change.files) ? payload.change.files : [],
      patch: null,
      githubPrUrl: null,
    });
  }
  return revisions;
}

function publishedSessionsFromPayload(
  payload: PrEventPayload,
): PublishedSessionRow[] {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  return sessions.slice(0, 20).flatMap((session) => {
    if (!session || typeof session !== "object") return [];
    return [{
      sessionId: typeof session.id === "string" ? session.id : "",
      command: typeof session.command === "string" ? session.command : null,
      cwd: typeof session.cwd === "string" ? session.cwd : null,
      requestCount: Array.isArray(session.requests) ? session.requests.length : 0,
      responseCount: 0,
    }];
  });
}

export async function generateSummary(
  db: postgres.Sql,
  input: GenerateSummaryInput,
): Promise<GenerateSummaryResult> {
  const target = await resolveSummaryTarget(db, input.orgId, input);
  if (!input.skipQuotaCheck) {
    const quota = await checkPrSummaryQuota(
      db,
      input.orgId,
      target.bookmarkId,
      input.userId,
    );
    if (!quota.allowed) {
      const reason = quota.reason ?? "trial_expired";
      capture(
        Events.SummaryQuotaBlocked,
        {
          bookmark_id: target.bookmarkId,
          event_id: target.eventId,
          used: quota.used,
          limit: quota.limit,
          reason,
          source: input.quotaSkipSource ?? "summary_api",
          pr_number: input.quotaSkipPrNumber ?? null,
          repo: input.quotaSkipRepoFullName ?? null,
        },
        input.orgId,
      );
      await recordGithubPostSkip(db, {
        orgId: input.orgId,
        bookmarkId: target.bookmarkId,
        eventId: target.eventId,
        reason,
        source: input.quotaSkipSource ?? "summary_api",
        prNumber: input.quotaSkipPrNumber,
        repoFullName: input.quotaSkipRepoFullName,
      });
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

  const validation = validateSummary(completion.text);
  if (!validation.ok) {
    assertValidSummary(completion.text);
  }
  const lineCount = validation.ok ? validation.lineCount : 0;
  const content = enrichSeverityDots(
    enrichSummaryLinks(
      completion.text,
      summaryLinkContextFromExtract(ctx, input.githubPrUrl),
    ),
  );

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

/** Build link context for enriching Notable Changes + Attribution lines. */
export function summaryLinkContextFromExtract(
  ctx: Pick<
    ExtractContext,
    "githubPrUrl" | "headCommitId" | "hunkLinks" | "publishedRevisions"
  >,
  prUrlOverride?: string | null,
): SummaryLinkContext {
  const changedFiles = [
    ...ctx.hunkLinks.map((h) => h.file),
    ...(ctx.publishedRevisions ?? []).flatMap((r) => r.files),
  ];
  return {
    prUrl: prUrlOverride ?? ctx.githubPrUrl,
    headSha: ctx.headCommitId,
    hunks: ctx.hunkLinks.map((h) => ({
      file: h.file,
      lineStart: h.lineStart,
      lineEnd: h.lineEnd,
    })),
    changedFiles,
  };
}
