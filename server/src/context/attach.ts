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
    file?: string;
    /** Concrete citable identifier (prior-PR rows: `branch@sha`). */
    ref?: string;
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
    /** Branch the change merges into; tells a topic branch from a trunk. */
    baseBranch?: string;
    headSha?: string;
    /** Other commit ids belonging to this change, so it cannot cite itself. */
    changeCommits?: string[];
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
      baseBranch: args.baseBranch,
      headSha: args.headSha,
      changeCommits: args.changeCommits,
    },
  });
  return {
    broker,
    indexSnippets: flattenBrokerSnippets(broker),
    contextBuckets: broker.buckets,
    contextManifest: broker.manifest,
  };
}
