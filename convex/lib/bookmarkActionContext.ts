import { v } from "convex/values";

/** Slim bookmark fields for Convex actions when Postgres is local-only. */
export const publishContextValidator = v.object({
  repoFullName: v.string(),
  headBranch: v.string(),
  baseBranch: v.string(),
  localHeadSha: v.union(v.string(), v.null()),
});

export const prChatContextValidator = v.object({
  changedFiles: v.array(v.string()),
  prBody: v.optional(v.string()),
  sessionSummary: v.optional(v.string()),
});

export type PublishContext = {
  repoFullName: string;
  headBranch: string;
  baseBranch: string;
  localHeadSha: string | null;
};

export type PrChatContextInput = {
  changedFiles: string[];
  prBody?: string;
  sessionSummary?: string;
};
