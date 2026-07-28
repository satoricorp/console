import type postgres from "postgres";
import { attachBrokerContext } from "../context/attach";
import { contextBrokerEnabled } from "../indexing/config";
import { searchIndex } from "../indexing/turbopuffer";
import { publishRevisions } from "../publish/revisions";
import type { PushBundle } from "../types";

type PrEventRow = {
  id: string;
  branch_name: string | null;
  payload: PushBundle | null;
};

export type ReviewRule = {
  id: string;
  repoScope: string | null;
  ruleText: string;
  scopeExpr: string | null;
  strength: string;
  status: string;
};

export type CollisionHint = {
  file: string;
  lineStart?: number;
  lineEnd?: number;
  kind: "hunk_overlap" | "merge_conflict";
  detail: string;
};

export type HunkLinkContext = {
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

export type IndexSnippet = {
  id: string;
  text: string;
  score?: number;
  sourceKind?: string;
};

export type ReviewContextResult = {
  repoRoot: string;
  base: string;
  head: string;
  refRange: string;
  rules: ReviewRule[];
  collisions: CollisionHint[];
  hunkLinks: HunkLinkContext[];
  indexSnippets: IndexSnippet[];
  indexAvailable: boolean;
};

export async function loadReviewContext(
  db: postgres.Sql,
  orgId: string,
  input: { repoRoot: string; base: string; head: string },
): Promise<ReviewContextResult> {
  const refRange = `${input.base}..${input.head}`;

  const rules = await db<{
    id: string;
    repo_scope: string | null;
    rule_text: string;
    scope_expr: string | null;
    strength: string;
    status: string;
  }[]>`
    SELECT id, repo_scope, rule_text, scope_expr, strength, status
    FROM rules
    WHERE org_id = ${orgId}
      AND status IN ('inferred', 'enforced')
    ORDER BY created_at_ms DESC
    LIMIT 100
  `;

  // The branch and the bundle's revisions come along for the ride: without them
  // the prior-PR bucket cannot tell this change apart from its own earlier
  // publishes, and would serve the change its own diff back as a "previous PR".
  const [event] = await db<PrEventRow[]>`
    SELECT id, branch_name, payload
    FROM pr_events
    WHERE org_id = ${orgId}
      AND repo_root_path = ${input.repoRoot}
      AND COALESCE(payload->>'refRange', '') = ${refRange}
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;

  const [fallbackEvent] = event
    ? [event]
    : await db<PrEventRow[]>`
        SELECT id, branch_name, payload
        FROM pr_events
        WHERE org_id = ${orgId}
          AND repo_root_path = ${input.repoRoot}
        ORDER BY created_at_ms DESC
        LIMIT 1
      `;

  const resolvedEvent = event ?? fallbackEvent;
  let hunkLinks: HunkLinkContext[] = [];
  if (resolvedEvent) {
    hunkLinks = await db<{
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
      WHERE org_id = ${orgId} AND event_id = ${resolvedEvent.id}
      ORDER BY file, line_start
    `.then((rows) =>
      rows.map((row) => ({
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
    );
  }

  const collisions = collisionHints(hunkLinks);

  // Capture regularly produces no hunk links at all, and the prior-PR bucket
  // needs the changed-file list to establish relevance. The bundle's revisions
  // always name their files, so union both rather than depend on capture.
  const revisions = resolvedEvent?.payload
    ? publishRevisions(resolvedEvent.payload)
    : [];
  const changedFiles = [
    ...new Set([
      ...hunkLinks.map((h) => h.file),
      ...revisions.flatMap((revision) => revision.files ?? []),
    ]),
  ].filter((file) => file.trim().length > 0);

  let indexSnippets: IndexSnippet[] = [];
  let indexAvailable = false;
  const repoFullName = await resolveRepoFullName(db, orgId, input.repoRoot);
  if (repoFullName) {
    try {
      if (contextBrokerEnabled()) {
        const attached = await attachBrokerContext(db, {
          orgId,
          repoFullName,
          changedFiles,
          branch: resolvedEvent?.branch_name ?? undefined,
          baseBranch:
            revisions.find((revision) => revision.base_branch_name?.trim())
              ?.base_branch_name ??
            resolvedEvent?.payload?.repo?.default_branch ??
            undefined,
          headSha: input.head,
          changeCommits: revisions
            .map((revision) => revision.commit_id ?? "")
            .filter((commit) => commit.trim().length > 0),
        });
        indexSnippets = attached.indexSnippets.map((s) => ({
          id: s.id,
          text: s.text,
          score: s.score,
          sourceKind: s.sourceKind,
        }));
        indexAvailable =
          attached.indexSnippets.length > 0 ||
          Boolean(process.env.OPENAI_API_KEY && process.env.TURBOPUFFER_API_KEY);
      } else {
        const query = [input.repoRoot, input.head, ...hunkLinks.map((h) => h.file)]
          .filter(Boolean)
          .join(" ");
        const hits = await searchIndex({
          orgId,
          repoFullName,
          query,
          limit: 8,
        });
        indexAvailable =
          hits.length > 0 ||
          Boolean(process.env.OPENAI_API_KEY && process.env.TURBOPUFFER_API_KEY);
        indexSnippets = hits.map((hit) => ({
          id: hit.id,
          text: hit.text,
          score: hit.score,
          sourceKind:
            typeof hit.attributes.source_kind === "string"
              ? hit.attributes.source_kind
              : undefined,
        }));
      }
    } catch (error) {
      console.warn("review broker context failed", {
        repo: repoFullName,
        error: error instanceof Error ? error.message : String(error),
      });
      indexSnippets = [];
    }
  }

  return {
    repoRoot: input.repoRoot,
    base: input.base,
    head: input.head,
    refRange,
    rules: rules.map((rule) => ({
      id: rule.id,
      repoScope: rule.repo_scope,
      ruleText: rule.rule_text,
      scopeExpr: rule.scope_expr,
      strength: rule.strength,
      status: rule.status,
    })),
    collisions,
    hunkLinks,
    indexSnippets,
    indexAvailable,
  };
}

async function resolveRepoFullName(
  db: postgres.Sql,
  orgId: string,
  repoRoot: string,
): Promise<string | null> {
  const [bookmark] = await db<{ repo_full_name: string }[]>`
    SELECT b.repo_full_name
    FROM bookmarks b
    JOIN pr_events pe ON pe.id = b.latest_event_id
    WHERE b.org_id = ${orgId}
      AND pe.repo_root_path = ${repoRoot}
    ORDER BY b.updated_at_ms DESC
    LIMIT 1
  `;
  return bookmark?.repo_full_name ?? null;
}

function collisionHints(hunkLinks: HunkLinkContext[]): CollisionHint[] {
  const hints: CollisionHint[] = [];

  const fileSessions = new Map<string, Set<string>>();
  for (const link of hunkLinks) {
    const sessions = fileSessions.get(link.file) ?? new Set<string>();
    sessions.add(link.sessionId);
    fileSessions.set(link.file, sessions);
  }
  for (const [file, sessions] of fileSessions) {
    if (sessions.size > 1) {
      hints.push({
        file,
        kind: "hunk_overlap",
        detail: `Multiple sessions (${[...sessions].join(", ")}) touched this file`,
      });
    }
  }

  return hints;
}
