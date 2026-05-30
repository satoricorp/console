import { v } from "convex/values";

export type ChatPinInput = {
  filePath: string;
  side: "additions" | "deletions";
  startLine: number;
  endLine: number;
  text: string;
};

export const chatPinValidator = {
  filePath: v.string(),
  side: v.union(v.literal("additions"), v.literal("deletions")),
  startLine: v.number(),
  endLine: v.number(),
  text: v.string(),
};
