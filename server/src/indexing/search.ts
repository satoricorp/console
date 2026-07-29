import {
  embeddingProfileForNamespace,
  indexingConfig,
  namespaceForOrgRepo,
} from "./config";
import {
  embedTexts,
  fetchImpl,
  isRecord,
  namespaceURL,
  turboPufferHeaders,
} from "./turbopuffer";

export type IndexSearchResult = {
  id: string;
  score?: number;
  text: string;
  attributes: Record<string, unknown>;
};

export async function embedQueryText(query: string): Promise<number[] | null> {
  const cfg = indexingConfig();
  if (!cfg) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  const [vector] = await embedTexts(cfg, [trimmed]);
  return vector ?? null;
}

export type NamespaceMetadata = {
  exists: boolean;
  approxRowCount?: number;
  lastWriteAt?: string;
};

/**
 * Probe one namespace: does it exist, how big is it, when was it last written.
 *
 * The CLI's review evidence lines depend on the distinction this makes: a
 * namespace that does not exist means "this repository has never been indexed"
 * (actionable — connect it), while an existing-but-stale one means "results may
 * describe deleted code". A 404 is therefore a normal answer, not an error.
 */
export async function fetchNamespaceMetadata(
  namespace: string,
): Promise<NamespaceMetadata | null> {
  const cfg = indexingConfig();
  if (!cfg) return null;
  const response = await fetchImpl(namespaceURL(cfg, namespace, "metadata"), {
    headers: turboPufferHeaders(cfg),
  });
  if (response.status === 404) {
    return { exists: false };
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `namespace metadata: status ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`,
    );
  }
  const decoded = (await response.json()) as {
    approx_row_count?: number;
    last_write_at?: string;
  };
  return {
    exists: true,
    approxRowCount:
      typeof decoded.approx_row_count === "number" ? decoded.approx_row_count : undefined,
    lastWriteAt:
      typeof decoded.last_write_at === "string" ? decoded.last_write_at : undefined,
  };
}

export async function searchIndex(args: {
  orgId: string;
  repoFullName: string;
  query: string;
  limit?: number;
  sourceKinds?: string[];
  /** Override namespace (e.g. shared knowledge). When set, org/repo filters are not applied unless includeOrgFilter. */
  namespace?: string;
  includeOrgFilter?: boolean;
  extraFilters?: Array<[string, string, string]>;
  /** Precomputed embedding — avoids duplicate OpenAI calls when querying multiple buckets. */
  vector?: number[];
  /**
   * Add BM25 legs alongside the vector search and fuse with RRF. Defaults on:
   * exact identifiers are the highest-signal query a reviewer issues and a
   * pure ANN search regularly misses them.
   */
  lexical?: boolean;
  /**
   * Explicit terms for the symbol BM25 leg. The CLI extracts identifiers from
   * the diff under review — a strictly better signal than re-deriving them
   * from the prose query — so when a caller supplies them they are used
   * verbatim instead of identifierTerms(query).
   */
  symbolQuery?: string;
}): Promise<IndexSearchResult[]> {
  const cfg = indexingConfig();
  if (!cfg) {
    return [];
  }
  const query = args.query.trim();
  if (!query && !args.vector) {
    return [];
  }

  const namespace = args.namespace ?? namespaceForOrgRepo(args.orgId, args.repoFullName);
  // Namespaces do not all share one vector width. A caller that fans one
  // precomputed embedding across several buckets would otherwise send a
  // wrong-width vector to any namespace built at a different width, and
  // TurboPuffer rejects the query — losing that bucket entirely. Re-embed
  // rather than fail.
  const profile = embeddingProfileForNamespace(namespace);
  let vector = args.vector;
  if (vector && vector.length !== profile.dimensions) {
    vector = undefined;
  }
  vector ??= (await embedTexts(cfg, [query], profile))[0];
  if (!vector) {
    return [];
  }

  const filterClauses: Array<[string, string, string] | ["Or", Array<[string, string, string]>]> = [];
  const useOrgFilter = args.includeOrgFilter ?? !args.namespace;
  if (useOrgFilter) {
    filterClauses.push(["org_id", "Eq", args.orgId]);
    filterClauses.push(["repo_full_name", "Eq", args.repoFullName]);
  }
  if (args.sourceKinds && args.sourceKinds.length === 1) {
    filterClauses.push(["source_kind", "Eq", args.sourceKinds[0]!]);
  } else if (args.sourceKinds && args.sourceKinds.length > 1) {
    filterClauses.push([
      "Or",
      args.sourceKinds.map((kind) => ["source_kind", "Eq", kind] as [string, string, string]),
    ]);
  }
  for (const extra of args.extraFilters ?? []) {
    filterClauses.push(extra);
  }

  // 100, not 50: the review-search route serves the CLI's deep mode, which
  // asks for up to 96 rows and truncates after its own fusion. Existing
  // broker/history callers stay well under the old ceiling.
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 100);
  let filters: unknown;
  if (filterClauses.length === 1) {
    filters = filterClauses[0];
  } else if (filterClauses.length > 1) {
    filters = ["And", filterClauses];
  }

  const body = buildSearchBody({
    vector,
    query,
    limit,
    filters,
    // Lexical legs are only safe where this codebase owns the schema. An
    // explicit namespace override points at a foreign corpus (the shared
    // review-knowledge namespace has no `symbol` field), so it stays
    // vector-only unless the caller asks otherwise.
    lexical: args.lexical ?? !args.namespace,
    symbolQuery: args.symbolQuery,
  });

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

  const decoded = (await response.json()) as {
    rows?: unknown[];
    results?: Array<{ rows?: unknown[] }>;
  };
  // A fused query answers with one leg per rank_by and TurboPuffer applies
  // `limit` per leg, so an RRF search over three legs can return up to three
  // times what the caller asked for. That over-return is deliberately passed
  // through: searchCodeReviewHistory searches unfiltered and narrows to its two
  // source kinds in JavaScript, so capping here would starve it (and with it
  // GET /v1/review-history) rather than the bucket that actually over-served.
  // Callers that need a hard cap apply it after their own filtering — see
  // toSnippets in the context broker.
  const rows = decoded.rows ?? decoded.results?.[0]?.rows ?? [];
  return rows.flatMap((row) => {
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

/**
 * Build the query body: a vector leg, plus BM25 legs over `text` and (when the
 * query looks like it names an identifier) `symbol`, fused with reciprocal rank
 * fusion.
 *
 * RRF is used rather than weighted score blending because BM25 scores and
 * cosine distances are not on a comparable scale; RRF only needs each leg's
 * ordering, so no per-corpus tuning is required.
 */
export function buildSearchBody(args: {
  vector: number[];
  query: string;
  limit: number;
  filters?: unknown;
  lexical: boolean;
  /** Explicit symbol-leg terms; when absent they are derived from the query. */
  symbolQuery?: string;
}): Record<string, unknown> {
  const withFilters = (leg: Record<string, unknown>): Record<string, unknown> => {
    if (args.filters !== undefined) leg.filters = args.filters;
    return leg;
  };
  const vectorLeg = withFilters({
    rank_by: ["vector", "ANN", args.vector],
    limit: args.limit,
    include_attributes: true,
  });

  const text = args.query.trim();
  if (!args.lexical || !text) {
    return vectorLeg;
  }

  const legs: Record<string, unknown>[] = [vectorLeg, withFilters({
    rank_by: ["text", "BM25", text],
    limit: args.limit,
    include_attributes: true,
  })];
  const identifiers = args.symbolQuery?.trim() || identifierTerms(text);
  if (identifiers) {
    legs.push(
      withFilters({
        rank_by: ["symbol", "BM25", identifiers],
        limit: args.limit,
        include_attributes: true,
      }),
    );
  }
  for (const leg of legs) {
    leg.limit = { total: args.limit };
  }
  return { queries: legs, rerank_by: ["RRF"] };
}

/**
 * Extract identifier-shaped tokens from a query and expand them into the same
 * word parts the writer stored, so `symbol` BM25 matches both the verbatim
 * identifier and its camelCase pieces. Returns "" when the query names no
 * identifier, so the symbol leg is skipped rather than diluting the fusion.
 */
export function identifierTerms(query: string): string {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    terms.push(value);
  };
  for (const token of query.split(/[^A-Za-z0-9_$.]+/)) {
    if (!token || token.length < 3) continue;
    const looksLikeIdentifier =
      /[a-z][A-Z]/.test(token) || token.includes("_") || token.includes(".") || /[A-Z]{2,}/.test(token);
    if (!looksLikeIdentifier) continue;
    add(token);
    for (const part of token.split(/[_.]|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const lower = part.toLowerCase();
      if (lower.length >= 2) add(lower);
    }
  }
  return terms.join(" ");
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
