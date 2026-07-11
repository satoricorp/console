import type postgres from "postgres";
import {
  capFilePatches,
  splitUnifiedDiff,
  type FilePatch,
} from "./patch";
import type { UsageBreakdown } from "./types";
import { buildUsageBreakdown } from "./usage";

export type AgentProvenanceEntry = {
  sessionId: string;
  agentTool: string;
  provider?: string;
  modelId?: string;
  source?: unknown;
};

export type SelfReport = {
  taskSummary?: string;
  commandsRun?: string[];
  testsRun?: string[];
  raw?: unknown;
};

export type ReviewRevisionContext = {
  changeId: string;
  branchName: string | null;
  baseBranchName: string | null;
  description: string | null;
  files: string[];
  patch: string | null;
  filePatches: FilePatch[];
  risk?: { level?: string; score?: number; signals?: string[] };
  changedSymbols?: Array<{
    file?: string;
    symbol?: string;
    kind?: string;
    startLine?: number;
    endLine?: number;
  }>;
  agentProvenance: AgentProvenanceEntry[];
};

export type HunkAttribution = {
  file: string;
  lineStart: number;
  lineEnd: number;
  authorship: string;
  tool: string | null;
  model: string | null;
  sessionId: string;
};

export type ReviewPlanContext = {
  orgId: string;
  bookmarkId: string;
  eventId: string | null;
  headCommitId: string;
  repoFullName: string;
  branchName: string;
  baseBranch: string;
  title: string | null;
  revisions: ReviewRevisionContext[];
  allFiles: string[];
  cappedPatches: FilePatch[];
  intent: {
    selfReport: SelfReport | null;
    firstUserMessages: string[];
    demuxIntents: string[];
    descriptions: string[];
  };
  hunkLinks: HunkAttribution[];
  usage: UsageBreakdown;
  risk: { level?: string; score?: number; signals?: string[] } | null;
};

type StackEntry = {
  change?: {
    id?: number | string;
    jj_change_id?: string;
    description?: string;
    files?: string[];
    review_context?: {
      risk?: { level?: string; score?: number; signals?: string[] };
      changed_symbols?: Array<{
        file?: string;
        symbol?: string;
        kind?: string;
        start_line?: number;
        end_line?: number;
      }>;
      agent_provenance?: unknown[];
      demux_evidence?: Array<{ intent?: string }>;
    };
  };
  branch_name?: string;
  base_branch_name?: string;
  patch?: string;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function changeIdFrom(entry: StackEntry, index: number): string {
  const change = entry.change;
  return (
    asString(change?.jj_change_id) ||
    (change?.id != null ? String(change.id) : null) ||
    `rev-${index}`
  );
}

function parseProvenance(raw: unknown[]): AgentProvenanceEntry[] {
  const out: AgentProvenanceEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sessionId = asString(row.session_id);
    const agentTool = asString(row.agent_tool);
    if (!sessionId || !agentTool) continue;
    out.push({
      sessionId,
      agentTool,
      provider: asString(row.provider) ?? undefined,
      modelId: asString(row.model_id) ?? undefined,
      source: row.source,
    });
  }
  return out;
}

function extractSelfReport(provenance: AgentProvenanceEntry[]): SelfReport | null {
  for (const entry of provenance) {
    if (entry.agentTool !== "gx_commit") continue;
    const source = entry.source;
    if (!source || typeof source !== "object") continue;
    const row = source as Record<string, unknown>;
    return {
      taskSummary: asString(row.task_summary) ?? undefined,
      commandsRun: Array.isArray(row.commands_run)
        ? row.commands_run.filter((x): x is string => typeof x === "string")
        : undefined,
      testsRun: Array.isArray(row.tests_run)
        ? row.tests_run.filter((x): x is string => typeof x === "string")
        : undefined,
      raw: source,
    };
  }
  return null;
}

function firstUserMessages(sessions: unknown[]): string[] {
  const messages: string[] = [];
  for (const session of sessions) {
    if (!session || typeof session !== "object") continue;
    const requests = (session as { requests?: unknown[] }).requests;
    if (!Array.isArray(requests)) continue;
    for (const req of requests) {
      if (!req || typeof req !== "object") continue;
      const row = req as Record<string, unknown>;
      const candidates = [
        row.user_message,
        row.prompt,
        row.input,
        row.message,
        typeof row.request_body === "string" ? row.request_body : null,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim()) {
          messages.push(c.trim().slice(0, 1000));
          break;
        }
      }
      if (messages.length > 0) break;
    }
    if (messages.length >= 5) break;
  }
  return messages.slice(0, 5);
}

function demuxIntents(stack: StackEntry[]): string[] {
  const intents: string[] = [];
  for (const entry of stack) {
    const evidence = entry.change?.review_context?.demux_evidence;
    if (!Array.isArray(evidence)) continue;
    for (const item of evidence) {
      const intent = asString(item?.intent);
      if (intent) intents.push(intent.slice(0, 500));
    }
  }
  return intents.slice(0, 10);
}

/**
 * Load review-plan context via jsonb path projections — never SELECT payload wholesale.
 */
export async function loadReviewPlanContext(
  db: postgres.Sql,
  args: {
    orgId: string;
    bookmarkId: string;
    eventId?: string | null;
    headCommitId: string;
  },
): Promise<ReviewPlanContext | null> {
  const [bookmark] = await db<{
    id: string;
    org_id: string;
    repo_full_name: string;
    branch_name: string;
    title: string | null;
    head_commit_id: string | null;
    latest_event_id: string | null;
    app_base_branch: string | null;
  }[]>`
    SELECT
      id, org_id, repo_full_name, branch_name, title,
      head_commit_id, latest_event_id, app_base_branch
    FROM bookmarks
    WHERE id = ${args.bookmarkId}::uuid
      AND org_id = ${args.orgId}::uuid
    LIMIT 1
  `;
  if (!bookmark) return null;

  const eventId = args.eventId ?? bookmark.latest_event_id;
  if (!eventId) return null;

  const [event] = await db<{
    id: string;
    head_commit_id: string;
    stack: unknown;
    sessions: unknown;
    change_provenance: unknown;
    change_risk: unknown;
    push_branch: string | null;
    base_from_stack: string | null;
  }[]>`
    SELECT
      id,
      head_commit_id,
      CASE
        WHEN jsonb_typeof(payload->'stack') = 'array' THEN payload->'stack'
        ELSE '[]'::jsonb
      END AS stack,
      CASE
        WHEN jsonb_typeof(payload->'sessions') = 'array' THEN payload->'sessions'
        ELSE '[]'::jsonb
      END AS sessions,
      CASE
        WHEN jsonb_typeof(payload->'change'->'review_context'->'agent_provenance') = 'array'
          THEN payload->'change'->'review_context'->'agent_provenance'
        ELSE '[]'::jsonb
      END AS change_provenance,
      payload->'change'->'review_context'->'risk' AS change_risk,
      payload->'push'->>'branch_name' AS push_branch,
      (
        SELECT entry->>'base_branch_name'
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(payload->'stack') = 'array' THEN payload->'stack'
            ELSE '[]'::jsonb
          END
        ) AS entry
        WHERE entry->>'base_branch_name' IS NOT NULL
        LIMIT 1
      ) AS base_from_stack
    FROM pr_events
    WHERE id = ${eventId}::uuid
    LIMIT 1
  `;
  if (!event) return null;

  const stack = (Array.isArray(event.stack) ? event.stack : []) as StackEntry[];
  // If stack empty, synthesize from top-level change via a second projection
  let entries = stack;
  if (entries.length === 0) {
    const [fallback] = await db<{
      change: unknown;
      patch: string | null;
      branch_name: string | null;
      base_branch_name: string | null;
    }[]>`
      SELECT
        payload->'change' AS change,
        payload->'stack'->0->>'patch' AS patch,
        COALESCE(payload->'push'->>'branch_name', payload->'repo'->>'branch_name') AS branch_name,
        payload->'stack'->0->>'base_branch_name' AS base_branch_name
      FROM pr_events
      WHERE id = ${eventId}::uuid
      LIMIT 1
    `;
    if (fallback?.change) {
      entries = [
        {
          change: fallback.change as StackEntry["change"],
          patch: fallback.patch ?? undefined,
          branch_name: fallback.branch_name ?? undefined,
          base_branch_name: fallback.base_branch_name ?? undefined,
        },
      ];
    }
  }

  const allProvenance: AgentProvenanceEntry[] = [
    ...parseProvenance(
      Array.isArray(event.change_provenance) ? (event.change_provenance as unknown[]) : [],
    ),
  ];

  const revisions: ReviewRevisionContext[] = entries.map((entry, index) => {
    const provenance = parseProvenance(
      Array.isArray(entry.change?.review_context?.agent_provenance)
        ? entry.change!.review_context!.agent_provenance!
        : [],
    );
    allProvenance.push(...provenance);
    const patch = typeof entry.patch === "string" ? entry.patch : null;
    const filePatches = patch ? splitUnifiedDiff(patch) : [];
    const files =
      (Array.isArray(entry.change?.files) ? entry.change!.files! : []).filter(
        (f): f is string => typeof f === "string",
      ) || filePatches.map((f) => f.file);

    return {
      changeId: changeIdFrom(entry, index),
      branchName: asString(entry.branch_name),
      baseBranchName: asString(entry.base_branch_name),
      description: asString(entry.change?.description),
      files: [...new Set(files)],
      patch,
      filePatches,
      risk: entry.change?.review_context?.risk,
      changedSymbols: (entry.change?.review_context?.changed_symbols ?? []).map((s) => ({
        file: s.file,
        symbol: s.symbol,
        kind: s.kind,
        startLine: s.start_line,
        endLine: s.end_line,
      })),
      agentProvenance: provenance,
    };
  });

  const allFiles = [...new Set(revisions.flatMap((r) => r.files))];
  const cappedPatches = capFilePatches(revisions.flatMap((r) => r.filePatches));

  const sessions = Array.isArray(event.sessions) ? event.sessions : [];
  const usage = buildUsageBreakdown({
    sessions,
    agentProvenance: allProvenance.map((p) => ({
      session_id: p.sessionId,
      agent_tool: p.agentTool,
      provider: p.provider,
      model_id: p.modelId,
      source: p.source,
    })),
  });

  const selfReport = extractSelfReport(allProvenance);

  // Secondary attribution: hunk_links joined via pr_events.head_commit_id
  const hunkLinks = await db<{
    file: string | null;
    line_start: number | null;
    line_end: number | null;
    authorship: string | null;
    tool: string | null;
    model: string | null;
    session_id: string | null;
  }[]>`
    SELECT hl.file, hl.line_start, hl.line_end, hl.authorship, hl.tool, hl.model, hl.session_id
    FROM hunk_links hl
    INNER JOIN pr_events pe ON pe.id = hl.event_id
    WHERE hl.org_id = ${args.orgId}::uuid
      AND pe.head_commit_id = ${args.headCommitId}
    ORDER BY hl.confidence DESC NULLS LAST
    LIMIT 200
  `.catch(() => [] as Array<{
    file: string | null;
    line_start: number | null;
    line_end: number | null;
    authorship: string | null;
    tool: string | null;
    model: string | null;
    session_id: string | null;
  }>);

  const risk =
    (event.change_risk && typeof event.change_risk === "object"
      ? (event.change_risk as ReviewPlanContext["risk"])
      : null) ||
    revisions.find((r) => r.risk)?.risk ||
    null;

  return {
    orgId: args.orgId,
    bookmarkId: args.bookmarkId,
    eventId,
    headCommitId: args.headCommitId || event.head_commit_id,
    repoFullName: bookmark.repo_full_name,
    branchName: bookmark.branch_name,
    baseBranch:
      bookmark.app_base_branch ||
      asString(event.base_from_stack) ||
      revisions.find((r) => r.baseBranchName)?.baseBranchName ||
      "main",
    title: bookmark.title,
    revisions,
    allFiles,
    cappedPatches,
    intent: {
      selfReport,
      firstUserMessages: firstUserMessages(sessions as unknown[]),
      demuxIntents: demuxIntents(entries),
      descriptions: revisions
        .map((r) => r.description)
        .filter((d): d is string => Boolean(d)),
    },
    hunkLinks: hunkLinks
      .filter((h) => h.file && h.session_id)
      .map((h) => ({
        file: h.file!,
        lineStart: h.line_start ?? 0,
        lineEnd: h.line_end ?? 0,
        authorship: h.authorship ?? "unknown",
        tool: h.tool,
        model: h.model,
        sessionId: h.session_id!,
      })),
    usage,
    risk,
  };
}

export function changedFileSet(ctx: ReviewPlanContext): Set<string> {
  return new Set(ctx.allFiles);
}

export function filePatchIndex(ctx: ReviewPlanContext): Map<string, FilePatch> {
  const map = new Map<string, FilePatch>();
  for (const rev of ctx.revisions) {
    for (const fp of rev.filePatches) {
      if (!map.has(fp.file)) map.set(fp.file, fp);
    }
  }
  for (const fp of ctx.cappedPatches) {
    if (!map.has(fp.file)) map.set(fp.file, fp);
  }
  return map;
}
