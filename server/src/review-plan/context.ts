import type postgres from "postgres";
import { attachBrokerContext } from "../context/attach";
import { emptyBrokerResult } from "../context/broker";
import type {
  ContextBucket,
  ContextManifestEntry,
  ContextSnippet,
} from "../context/broker";
import {
  fetchPullRequestFilePatches,
  githubFilesToUnifiedDiff,
} from "../github/pr-patches";
import {
  capFilePatches,
  splitUnifiedDiff,
  type FilePatch,
} from "./patch";
import {
  classifyFileForReview,
  type FileReviewPriority,
} from "./priority";
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
  /** Commit this revision published as; scopes prior-PR rows to this change. */
  commitId: string | null;
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
  filePriorities?: FileReviewPriority[];
  intent: {
    selfReport: SelfReport | null;
    firstUserMessages: string[];
    demuxIntents: string[];
    descriptions: string[];
  };
  hunkLinks: HunkAttribution[];
  usage: UsageBreakdown;
  risk: { level?: string; score?: number; signals?: string[] } | null;
  contextBuckets?: Record<ContextBucket, ContextSnippet[]>;
  contextManifest?: Record<ContextBucket, ContextManifestEntry>;
  /** True when non-indexed PR/session payload evidence was available for prompts. */
  prPayloadPresent?: boolean;
};

type StackEntry = {
  /** v2 revisions carry the commit directly; v1 kept it under `change`. */
  commit_id?: string;
  change?: {
    id?: number | string;
    jj_change_id?: string;
    current_commit_id?: string;
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
    github_pr_number: number | null;
  }[]>`
    SELECT
      id, org_id, repo_full_name, branch_name, title,
      head_commit_id, latest_event_id, app_base_branch, github_pr_number
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
    revisions: unknown;
    stack: unknown;
    sessions: unknown;
    change_provenance: unknown;
    change_risk: unknown;
    push_branch: string | null;
  }[]>`
    SELECT
      id,
      head_commit_id,
      CASE
        WHEN jsonb_typeof(payload->'revisions') = 'array' THEN payload->'revisions'
        ELSE '[]'::jsonb
      END AS revisions,
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
      payload->'push'->>'branch_name' AS push_branch
    FROM pr_events
    WHERE id = ${eventId}::uuid
    LIMIT 1
  `;
  if (!event) return null;

  // Schema v2 publishes a flat `revisions` list; adapt it onto the legacy
  // StackEntry shape so the mapping below serves both bundle generations.
  const revisionEntries = (Array.isArray(event.revisions) ? event.revisions : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row): StackEntry => ({
      change: {
        jj_change_id: typeof row.revision_id === "string" ? row.revision_id : undefined,
        description: typeof row.description === "string" ? row.description : undefined,
        files: Array.isArray(row.files)
          ? row.files.filter((f): f is string => typeof f === "string")
          : undefined,
        review_context: (row.review_context ?? undefined) as NonNullable<
          StackEntry["change"]
        >["review_context"],
      },
      branch_name: typeof row.branch_name === "string" ? row.branch_name : undefined,
      base_branch_name:
        typeof row.base_branch_name === "string" ? row.base_branch_name : undefined,
      patch: typeof row.patch === "string" ? row.patch : undefined,
    }));

  const stack = (Array.isArray(event.stack) ? event.stack : []) as StackEntry[];
  // Prefer v2 revisions; if the v1 stack is empty too, synthesize from the
  // top-level change via a second projection.
  let entries = revisionEntries.length > 0 ? revisionEntries : stack;
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
      const rawPatch =
        typeof fallback.patch === "string" && fallback.patch.trim()
          ? fallback.patch
          : null;
      entries = [
        {
          change: fallback.change as StackEntry["change"],
          patch: rawPatch ?? undefined,
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

  let revisions: ReviewRevisionContext[] = entries.map((entry, index) => {
    const provenance = parseProvenance(
      Array.isArray(entry.change?.review_context?.agent_provenance)
        ? entry.change!.review_context!.agent_provenance!
        : [],
    );
    allProvenance.push(...provenance);
    // Empty string patches are common from some GX clients — treat as missing.
    const rawPatch = typeof entry.patch === "string" ? entry.patch : null;
    const patch = rawPatch && rawPatch.trim() ? rawPatch : null;
    const filePatches = patch ? splitUnifiedDiff(patch) : [];
    const listedFiles = (
      Array.isArray(entry.change?.files) ? entry.change!.files! : []
    ).filter((f): f is string => typeof f === "string");
    const files =
      listedFiles.length > 0 ? listedFiles : filePatches.map((f) => f.file);

    return {
      changeId: changeIdFrom(entry, index),
      // v2 revisions carry commit_id directly; v1 stack entries kept it on the change.
      commitId:
        asString(entry.commit_id) ?? asString(entry.change?.current_commit_id),
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

  // When the published artifact omitted patch text, fall back to GitHub PR files.
  const hasFilePatches = revisions.some((r) => r.filePatches.length > 0);
  if (!hasFilePatches && bookmark.github_pr_number) {
    try {
      const ghFiles = await fetchPullRequestFilePatches(
        db,
        bookmark.repo_full_name,
        Number(bookmark.github_pr_number),
      );
      const unified = githubFilesToUnifiedDiff(ghFiles);
      if (unified.trim()) {
        const filePatches = splitUnifiedDiff(unified);
        const ghFileNames = filePatches.map((f) => f.file);
        if (revisions.length === 0) {
          revisions = [
            {
              changeId: "github-pr",
              // Reconstructed from GitHub's file list, so no publish commit exists.
              commitId: null,
              branchName: bookmark.branch_name,
              baseBranchName: bookmark.app_base_branch,
              description: bookmark.title,
              files: ghFileNames,
              patch: unified,
              filePatches,
              agentProvenance: [],
            },
          ];
        } else {
          revisions = revisions.map((rev, index) =>
            index === 0
              ? {
                  ...rev,
                  patch: unified,
                  filePatches,
                  files:
                    rev.files.length > 0
                      ? rev.files
                      : [...new Set([...rev.files, ...ghFileNames])],
                }
              : rev,
          );
        }
      }
    } catch (error) {
      console.error("GitHub PR patch fallback failed", error);
    }
  }

  const allFiles = [...new Set(revisions.flatMap((r) => r.files))];
  const cappedPatches = capFilePatches(revisions.flatMap((r) => r.filePatches));
  const patchByFile = new Map(
    revisions.flatMap((revision) =>
      revision.filePatches.map((patch) => [patch.file, patch] as const),
    ),
  );
  const changedSymbols = revisions.flatMap(
    (revision) => revision.changedSymbols ?? [],
  );
  const filePriorities = allFiles.map((file) =>
    classifyFileForReview(file, patchByFile.get(file), changedSymbols),
  );

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
      revisions.find((r) => r.baseBranchName)?.baseBranchName ||
      "main",
    title: bookmark.title,
    revisions,
    allFiles,
    cappedPatches,
    filePriorities,
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
    prPayloadPresent:
      sessions.length > 0 ||
      cappedPatches.length > 0 ||
      allProvenance.length > 0 ||
      revisions.some((r) => Boolean(r.description?.trim())),
    ...(await loadBrokerFields(db, {
      orgId: args.orgId,
      repoFullName: bookmark.repo_full_name,
      branchName: bookmark.branch_name,
      headCommitId: args.headCommitId || event.head_commit_id,
      allFiles,
      intentSummary: selfReport?.taskSummary,
      // Deliberately NOT ctx.baseBranch: that expression defaults to "main", and
      // claiming "main" for a repo whose trunk is "dev" makes the branch rule
      // treat the trunk as a topic branch and drop every prior-PR row. Leave it
      // undefined when genuinely unknown, matching the PR-summary path.
      baseBranch:
        bookmark.app_base_branch ||
        revisions.find((r) => r.baseBranchName)?.baseBranchName ||
        undefined,
      changeCommits: revisions
        .map((r) => r.commitId ?? "")
        .filter((commit) => commit.trim().length > 0),
    })),
  };
}

async function loadBrokerFields(
  db: postgres.Sql,
  args: {
    orgId: string;
    repoFullName: string;
    branchName: string;
    headCommitId: string;
    allFiles: string[];
    intentSummary?: string;
    baseBranch?: string;
    changeCommits?: string[];
  },
): Promise<{
  contextBuckets?: Record<ContextBucket, ContextSnippet[]>;
  contextManifest?: Record<ContextBucket, ContextManifestEntry>;
}> {
  try {
    const attached = await attachBrokerContext(db, {
      orgId: args.orgId,
      repoFullName: args.repoFullName,
      branch: args.branchName,
      headSha: args.headCommitId,
      changedFiles: args.allFiles,
      intent: args.intentSummary,
      baseBranch: args.baseBranch,
      changeCommits: args.changeCommits,
    });
    return {
      contextBuckets: attached.contextBuckets,
      contextManifest: attached.contextManifest,
    };
  } catch (error) {
    console.warn("review plan broker context failed", {
      repo: args.repoFullName,
      error: error instanceof Error ? error.message : String(error),
    });
    // Deliberately a manifest of zeros rather than `{}`. clampAttributionToManifest
    // reads a missing manifest as "the broker is off" and keeps the model's
    // self-reported attribution, so returning nothing here published attribution
    // percentages for buckets that supplied nothing — a retrieval outage
    // fabricating provenance, where a genuinely empty index clamps to zero.
    const empty = emptyBrokerResult();
    return { contextBuckets: empty.buckets, contextManifest: empty.manifest };
  }
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
