import { v } from "convex/values";

export const prChatContextValidator = v.object({
  changedFiles: v.array(v.string()),
  prBody: v.optional(v.string()),
  sessionSummary: v.optional(v.string()),
});

export type PrChatContextInput = {
  changedFiles: string[];
  prBody?: string;
  sessionSummary?: string;
};
