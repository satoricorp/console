"use node";

import { Turbopuffer } from "@turbopuffer/turbopuffer";
import { namespaceForOrgRepo } from "./utils";

let client: Turbopuffer | null = null;

export function getTurboPufferClient() {
  if (!client) {
    const apiKey = process.env.TURBOPUFFER_API_KEY;
    if (!apiKey) {
      throw new Error("TURBOPUFFER_API_KEY is not set");
    }
    client = new Turbopuffer({
      apiKey,
      region: process.env.TURBOPUFFER_REGION ?? "gcp-us-central1",
    });
  }
  return client;
}

export function getNamespace(orgId: string, fullName: string) {
  return getTurboPufferClient().namespace(namespaceForOrgRepo(orgId, fullName));
}

/**
 * The columns this writer sets, typed exactly as the other two writers type
 * them.
 *
 * A TurboPuffer namespace has one schema, and the GX Cloud server
 * (server/src/indexing/turbopuffer.ts) and the gx CLI
 * (internal/semantic/transcript_row.go) both push theirs on every upsert into
 * this same namespace. A column declared with a different type here would be
 * rejected, so `start_line` is uint rather than int, the body column is `text`
 * rather than `content`, and the two full-text columns keep their asymmetric
 * settings: `text` is stemmed for prose-style matching and `symbol` is not, so
 * an identifier lookup stays exact.
 */
export const TURBOPUFFER_SCHEMA = {
  vector: { type: "[1536]f32", ann: true },
  text: {
    type: "string",
    full_text_search: { stemming: true, remove_stopwords: false, case_sensitive: false },
  },
  symbol: {
    type: "string",
    full_text_search: { stemming: false, remove_stopwords: false, case_sensitive: false },
  },
  org_id: { type: "string", filterable: true },
  repo_full_name: { type: "string", filterable: true },
  source_kind: { type: "string", filterable: true },
  file_path: { type: "string", filterable: true },
  symbol_name: { type: "string", filterable: true },
  branch_name: { type: "string", filterable: true },
  chunk_hash: { type: "string", filterable: true },
  commit_id: { type: "string", filterable: true },
  language: { type: "string", filterable: true },
  doc_type: { type: "string", filterable: true },
  indexed_reason: { type: "string", filterable: true },
  start_line: { type: "uint", filterable: true },
  end_line: { type: "uint", filterable: true },
  created_at: { type: "uint" },
} as const;

/** The one source_kind this indexer writes. */
export const CODE_FILE_SOURCE_KIND = "code_file";

export async function ensureNamespaceSchema(orgId: string, fullName: string) {
  const ns = getNamespace(orgId, fullName);
  await ns.updateSchema({
    schema: TURBOPUFFER_SCHEMA,
  });
}

export type IndexedDocument = {
  id: string;
  vector: number[];
  /** Body column. Named `text` because that is what the shared namespace calls it. */
  text: string;
  symbol: string;
  org_id: string;
  repo_full_name: string;
  source_kind: string;
  file_path: string;
  symbol_name: string;
  branch_name: string;
  chunk_hash: string;
  commit_id: string;
  language: string;
  doc_type: string;
  indexed_reason: string;
  start_line: number;
  end_line: number;
  created_at: number;
};
