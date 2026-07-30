import { Hono } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";
import {
  indexingConfig,
  namespaceForOrgRepo,
  reviewKnowledgeNamespace,
} from "../indexing/config";
import { fetchNamespaceMetadata, searchIndex } from "../indexing/search";

/**
 * POST /v1/review/search — retrieval for `tx review`, gated through TX auth.
 *
 * The CLI's review context used to require a raw TURBOPUFFER_API_KEY (and an
 * OpenAI key for the semantic leg) in the reviewer's own environment, which no
 * onboarded user has: only dev machines ever retrieved anything. This route is
 * the same trade the /gx/openai and /gx/bedrock proxies made for inference —
 * the provider keys live here, the caller brings a TX login.
 *
 * It also closes the namespace question for good: the org and namespace are
 * resolved server-side from the caller's identity and the repository, with the
 * exact function every indexer writes through (namespaceForOrgRepo), so a
 * client cannot address a namespace the writers do not use.
 */
export const reviewSearchRoutes = new Hono<AppEnv>();

reviewSearchRoutes.use("/v1/review/search", requireAuth);

/**
 * Row kinds a repo-target search may filter on. An allowlist rather than a
 * pass-through so the route's query surface is exactly what reviews read; a
 * new kind is added here when a retriever learns to use it.
 */
export const REVIEW_SEARCH_SOURCE_KINDS = new Set([
  "code_file",
  "session_transcript",
  "session_context",
  "published_session_context",
  "published_revision_diff",
  "review_policy",
  "code_review_history",
  "code_review_summary",
]);

const MAX_SEARCH_LIMIT = 100;

export type ReviewSearchBody = {
  target?: string;
  repo_full_name?: string;
  query?: string;
  symbol_query?: string;
  source_kinds?: string[];
  limit?: number;
};

/**
 * The org whose index should answer for this repository.
 *
 * A caller can belong to several orgs (personal install + organization
 * install), and resolveOrgIdForGithubUser picks one by membership age — which
 * regularly is not the org whose installation covers the repository being
 * reviewed. Resolve through the repository instead, restricted to orgs the
 * caller is in; prefer the auth org on a tie, and fall back to it when the
 * repository is not connected anywhere the caller can see (the namespace then
 * simply does not exist, which the response reports honestly).
 */
export async function resolveSearchOrgId(
  db: postgres.Sql | postgres.TransactionSql,
  caller: { orgId: string; githubUserId: number | null },
  repoFullName: string,
): Promise<string> {
  const { orgId, githubUserId } = caller;
  const rows = await db<Array<{ id: string }>>`
    SELECT o.id
    FROM github_app_repositories r
    JOIN github_app_installations i
      ON i.installation_id = r.installation_id
    JOIN orgs o
      ON o.installation_id = i.installation_id
    WHERE lower(r.full_name) = lower(${repoFullName})
      AND r.access_state = 'installed'
      AND r.removed_at_ms IS NULL
      AND i.suspended_at_ms IS NULL
      AND (
        (${orgId || null}::uuid IS NOT NULL AND o.id = ${orgId || null}::uuid)
        OR (
          ${githubUserId}::bigint IS NOT NULL
          AND o.id IN (
            SELECT m.org_id FROM org_members m WHERE m.github_user_id = ${githubUserId}
          )
        )
      )
    ORDER BY COALESCE(o.id = ${orgId || null}::uuid, false) DESC, o.created_at_ms ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? orgId;
}

reviewSearchRoutes.post("/v1/review/search", async (c) => {
  const auth = c.get("auth");

  let body: ReviewSearchBody;
  try {
    body = (await c.req.json()) as ReviewSearchBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const target = body.target?.trim() || "repo";
  if (target !== "repo" && target !== "knowledge") {
    return c.json({ error: `target must be "repo" or "knowledge"` }, 400);
  }

  const query = body.query?.trim() ?? "";
  if (!query) {
    return c.json({ error: "query is required" }, 400);
  }

  const limit = Math.min(Math.max(Math.trunc(body.limit ?? 20), 1), MAX_SEARCH_LIMIT);

  // Retrieval disabled is an answer, not an error: the CLI reports the source
  // as unavailable instead of failing the review.
  if (!indexingConfig()) {
    return c.json({ available: false, reason: "indexing is not configured" });
  }

  if (target === "knowledge") {
    const namespace = reviewKnowledgeNamespace();
    const metadata = await fetchNamespaceMetadata(namespace).catch((error: unknown) => {
      throw httpError(error, "knowledge namespace metadata");
    });
    if (!metadata?.exists) {
      return c.json({
        available: true,
        target,
        namespace,
        exists: false,
        rows: [],
      });
    }
    const rows = await searchIndex({
      orgId: auth.orgId,
      repoFullName: "",
      query,
      limit,
      namespace,
      includeOrgFilter: false,
      extraFilters: [["source_kind", "Eq", "review_corpus"]],
    });
    return c.json({
      available: true,
      target,
      namespace,
      exists: true,
      approx_row_count: metadata.approxRowCount,
      last_write_at: metadata.lastWriteAt,
      rows: responseRows(rows, limit),
    });
  }

  const repoFullName = body.repo_full_name?.trim() ?? "";
  if (!/^[^\s/]+\/[^\s/]+$/.test(repoFullName)) {
    return c.json({ error: "repo_full_name must be owner/name" }, 400);
  }
  const sourceKinds = body.source_kinds ?? [];
  for (const kind of sourceKinds) {
    if (!REVIEW_SEARCH_SOURCE_KINDS.has(kind)) {
      return c.json(
        {
          error: `source_kind not allowed: ${kind}`,
          allowed: [...REVIEW_SEARCH_SOURCE_KINDS],
        },
        400,
      );
    }
  }

  const db = getSql();
  const orgId = await resolveSearchOrgId(
    db,
    {
      orgId: auth.orgId?.trim() ?? "",
      githubUserId: typeof auth.githubUserId === "number" ? auth.githubUserId : null,
    },
    repoFullName,
  );
  const namespace = namespaceForOrgRepo(orgId, repoFullName);
  const metadata = await fetchNamespaceMetadata(namespace).catch((error: unknown) => {
    throw httpError(error, "repo namespace metadata");
  });
  if (!metadata?.exists) {
    return c.json({
      available: true,
      target,
      namespace,
      exists: false,
      rows: [],
    });
  }

  const rows = await searchIndex({
    orgId,
    repoFullName,
    query,
    symbolQuery: body.symbol_query?.trim() || undefined,
    sourceKinds: sourceKinds.length > 0 ? sourceKinds : undefined,
    limit,
  });
  return c.json({
    available: true,
    target,
    namespace,
    exists: true,
    approx_row_count: metadata.approxRowCount,
    last_write_at: metadata.lastWriteAt,
    rows: responseRows(rows, limit),
  });
});

/**
 * Rows as the CLI consumes them. `text` is lifted to the top level and dropped
 * from attributes (it is by far the largest field; sending it twice doubles the
 * payload), and the fused over-return from multi-leg RRF is truncated to what
 * the caller asked for — order is TurboPuffer's fusion order, which is the
 * ranking the caller wants.
 */
function responseRows(
  rows: Array<{ id: string; score?: number; text: string; attributes: Record<string, unknown> }>,
  limit: number,
): Array<{ id: string; score?: number; text: string; attributes: Record<string, unknown> }> {
  return rows.slice(0, limit).map((row) => {
    const { text: _text, vector: _vector, ...attributes } = row.attributes;
    return { id: row.id, score: row.score, text: row.text, attributes };
  });
}

function httpError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${context}: ${message}`);
}
