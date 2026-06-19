import type postgres from "postgres";
import { searchIndex } from "../indexing/turbopuffer";

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

  const [event] = await db<{ id: string }[]>`
    SELECT id
    FROM pr_events
    WHERE org_id = ${orgId}
      AND repo_root_path = ${input.repoRoot}
      AND COALESCE(payload->>'refRange', '') = ${refRange}
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;

  const [fallbackEvent] = event
    ? [event]
    : await db<{ id: string }[]>`
        SELECT id
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

  const collisions = await loadCollisionHints(db, orgId, input.repoRoot, hunkLinks);

  let indexSnippets: IndexSnippet[] = [];
  let indexAvailable = false;
  const repoFullName = await resolveRepoFullName(db, orgId, input.repoRoot);
  if (repoFullName) {
    try {
      const query = [input.repoRoot, input.head, ...hunkLinks.map((h) => h.file)]
        .filter(Boolean)
        .join(" ");
      const hits = await searchIndex({
        orgId,
        repoFullName,
        query,
        limit: 8,
      });
      indexAvailable = hits.length > 0 || Boolean(process.env.OPENAI_API_KEY && process.env.TURBOPUFFER_API_KEY);
      indexSnippets = hits.map((hit) => ({
        id: hit.id,
        text: hit.text,
        score: hit.score,
        sourceKind:
          typeof hit.attributes.source_kind === "string"
            ? hit.attributes.source_kind
            : undefined,
      }));
    } catch {
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

async function loadCollisionHints(
  db: postgres.Sql,
  orgId: string,
  repoRoot: string,
  hunkLinks: HunkLinkContext[],
): Promise<CollisionHint[]> {
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

  const conflictRows = await db<{
    file: string;
    status: string;
    base_sha: string | null;
    head_sha: string | null;
  }[]>`
    SELECT cf.file, cc.status, cc.base_sha, cc.head_sha
    FROM conflict_checks cc
    JOIN conflict_files cf ON cf.check_id = cc.id
    JOIN bookmarks b ON b.id = cc.bookmark_id
    JOIN pr_events pe ON pe.id = b.latest_event_id
    WHERE cc.org_id = ${orgId}
      AND pe.repo_root_path = ${repoRoot}
      AND cc.status = 'conflicted'
    ORDER BY cc.updated_at_ms DESC
    LIMIT 50
  `;

  for (const row of conflictRows) {
    hints.push({
      file: row.file,
      kind: "merge_conflict",
      detail: `Merge conflict (${row.base_sha ?? "?"}..${row.head_sha ?? "?"})`,
    });
  }

  return hints;
}
