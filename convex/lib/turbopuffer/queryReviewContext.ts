"use node";

import type { Query } from "@turbopuffer/turbopuffer/resources/namespaces";
import { embedQuery } from "./embedTextBatch";
import {
  ensureNamespaceSchema,
  getNamespace,
} from "./turbopufferClient";

export type PinnedSelection = {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
};

export type QueryReviewContextRequest = {
  fullName: string;
  changedFiles: string[];
  query?: string;
  symbols?: string[];
  prTitle?: string;
  prBody?: string;
  sessionSummary?: string;
  pinnedSelections?: PinnedSelection[];
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
  const pinnedSelections = request.pinnedSelections ?? [];
  const pinnedFiles = [
    ...new Set([
      ...request.changedFiles,
      ...pinnedSelections.map((pin) => pin.filePath),
    ]),
  ];
  const pinnedText = pinnedSelections
    .map((pin) => {
      const lineLabel =
        pin.startLine === pin.endLine
          ? `${pin.startLine}`
          : `${pin.startLine}-${pin.endLine}`;
      return `${pin.filePath}:${lineLabel}\n${pin.text}`;
    })
    .join("\n\n");

  const queryText = [
    request.query,
    request.prTitle,
    request.prBody,
    request.sessionSummary,
    pinnedText,
    ...(request.symbols ?? []),
  ]
    .filter(Boolean)
    .join("\n");

  const ns = getNamespace(request.fullName);
  await ensureNamespaceSchema(request.fullName);
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

  const pathFilters = pinnedFiles.map(
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

  let resultLists: RankedRow[][];
  try {
    const response = await ns.multiQuery({ queries });
    resultLists = response.results.map(
      (result) => (result.rows ?? []) as RankedRow[],
    );
  } catch (error) {
    const pathFilterOnly =
      queries.length === 1 && pathFilters.length > 0 && !embedding;
    if (pathFilterOnly) {
      return { results: [] };
    }

    const fallbackQueries = queries.filter((query) => !query.filters);
    if (fallbackQueries.length === 0) {
      throw error;
    }

    const response = await ns.multiQuery({ queries: fallbackQueries });
    resultLists = response.results.map(
      (result) => (result.rows ?? []) as RankedRow[],
    );
  }

  const changedFileSet = new Set(pinnedFiles);
  const pinnedFileSet = new Set(pinnedSelections.map((pin) => pin.filePath));
  const fused = reciprocalRankFusion(
    resultLists,
    changedFileSet,
    pinnedFileSet,
  ).slice(0, Math.max(limit * 2, 20));

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

function reciprocalRankFusion(
  resultLists: RankedRow[][],
  changedFiles = new Set<string>(),
  pinnedFiles = new Set<string>(),
  k = 60,
): RankedRow[] {
  const scores = new Map<string | number, number>();
  const rows = new Map<string | number, RankedRow>();

  for (const list of resultLists) {
    list.forEach((row, rank) => {
      const id = row.id;
      let score = (scores.get(id) ?? 0) + 1 / (k + rank + 1);
      if (row.file_path && changedFiles.has(row.file_path)) {
        score += 0.05;
      }
      if (row.file_path && pinnedFiles.has(row.file_path)) {
        score += 0.15;
      }
      scores.set(id, score);
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
