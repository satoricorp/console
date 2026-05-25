"use node";

import { Turbopuffer } from "@turbopuffer/turbopuffer";
import { namespaceForRepo } from "./utils";

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

export function getNamespace(fullName: string) {
  return getTurboPufferClient().namespace(namespaceForRepo(fullName));
}

export const TURBOPUFFER_SCHEMA = {
  vector: { type: "[1536]f32", ann: true },
  content: { type: "string", full_text_search: true },
  file_path: { type: "string", glob: true },
  symbol: { type: "string", full_text_search: true },
  repo_id: { type: "string", filterable: true },
  commit_id: { type: "string", filterable: true },
  branch: { type: "string", filterable: true },
  language: { type: "string", filterable: true },
  doc_type: { type: "string", filterable: true },
  created_at: { type: "int", filterable: true },
} as const;

export type IndexedDocument = {
  id: string;
  vector: number[];
  content: string;
  file_path: string;
  symbol: string;
  repo_id: string;
  commit_id: string;
  branch: string;
  language: string;
  doc_type: string;
  created_at: number;
};
