import type postgres from "postgres";
import {
  flattenBrokerSnippets,
  retrieveReviewContext,
  type ContextBucket,
  type ContextManifestEntry,
  type ContextSnippet,
  type ReviewContextBrokerResult,
} from "./broker";

export type AttachedBrokerContext = {
  broker: ReviewContextBrokerResult;
  indexSnippets: Array<{
    id: string;
    text: string;
    score?: number;
    sourceKind?: string;
    bucket?: ContextBucket;
  }>;
  contextBuckets: Record<ContextBucket, ContextSnippet[]>;
  contextManifest: Record<ContextBucket, ContextManifestEntry>;
};

export async function attachBrokerContext(
  db: postgres.Sql,
  args: {
    orgId: string;
    repoFullName: string;
    intent?: string;
    changedFiles?: string[];
    symbols?: string[];
    branch?: string;
    headSha?: string;
  },
): Promise<AttachedBrokerContext> {
  const broker = await retrieveReviewContext(db, {
    orgId: args.orgId,
    repoFullName: args.repoFullName,
    queryTerms: {
      intent: args.intent,
      changedFiles: args.changedFiles,
      symbols: args.symbols,
      branch: args.branch,
      headSha: args.headSha,
    },
  });
  return {
    broker,
    indexSnippets: flattenBrokerSnippets(broker),
    contextBuckets: broker.buckets,
    contextManifest: broker.manifest,
  };
}
