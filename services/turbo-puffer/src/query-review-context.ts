import type { Query } from "@turbopuffer/turbopuffer/resources/namespaces";
import { embedQuery } from "./embed-text-batch";
import { getNamespace } from "./turbopuffer-client";

export type QueryReviewContextRequest = {
  fullName: string;
  changedFiles: string[];
  symbols?: string[];
  prTitle?: string;
  prBody?: string;
  sessionSummary?: string;
  limit?: number;
};

type RankedRow = {
  id: string | number;
  file_path?: string;
  doc_type?: string;
  symbol?: string;
  content?: string;
  commit_id?: string;
  dist?: number;
};

export async function queryReviewContext(request: QueryReviewContextRequest) {
  const limit = request.limit ?? 8;
  const queryText = [
    request.prTitle,
    request.prBody,
    request.sessionSummary,
    ...(request.symbols ?? []),
  ]
    .filter(Boolean)
    .join("\n");

  const ns = getNamespace(request.fullName);
  const embedding = queryText ? await embedQuery(queryText) : null;

  const queries: Query[] = [];

  if (embedding) {
    queries.push({
      rank_by: ["vector", "ANN", embedding],
      top_k: 30,
      include_attributes: [
        "content",
        "file_path",
        "doc_type",
        "symbol",
        "commit_id",
      ],
    });
    queries.push({
      rank_by: ["content", "BM25", queryText],
      top_k: 30,
      include_attributes: [
        "content",
        "file_path",
        "doc_type",
        "symbol",
        "commit_id",
      ],
    });
  }

  const pathFilters = request.changedFiles.map(
    (filePath) => ["file_path", "Eq", filePath] as ["file_path", "Eq", string],
  );

  if (pathFilters.length > 0) {
    queries.push({
      filters: ["Or", pathFilters],
      top_k: 20,
      include_attributes: [
        "content",
        "file_path",
        "doc_type",
        "symbol",
        "commit_id",
      ],
    });
  }

  if (queries.length === 0) {
    return { results: [] };
  }

  const response = await ns.multiQuery({ queries });
  const resultLists: RankedRow[][] = response.results.map(
    (result) => (result.rows ?? []) as RankedRow[],
  );

  const fused = reciprocalRankFusion(resultLists).slice(0, Math.max(limit * 2, 20));

  return {
    results: fused.slice(0, limit).map((row) => ({
      id: String(row.id),
      file_path: row.file_path ?? "",
      doc_type: row.doc_type ?? "",
      symbol: row.symbol ?? undefined,
      content: row.content ?? "",
      commit_id: row.commit_id ?? "",
      score: row.dist ?? 0,
    })),
  };
}

function reciprocalRankFusion(resultLists: RankedRow[][], k = 60): RankedRow[] {
  const scores = new Map<string | number, number>();
  const rows = new Map<string | number, RankedRow>();

  for (const list of resultLists) {
    list.forEach((row, rank) => {
      const id = row.id;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      rows.set(id, row);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => {
      const row = rows.get(id)!;
      return { ...row, dist: score };
    });
}
