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

export function formatPinnedSelections(pins: ChatPinInput[]): string {
  if (pins.length === 0) return "";

  return pins
    .map((pin) => {
      const lineLabel =
        pin.startLine === pin.endLine
          ? `${pin.startLine}`
          : `${pin.startLine}-${pin.endLine}`;
      const sideLabel = pin.side === "additions" ? "new" : "old";
      return `[${pin.filePath}:${lineLabel} (${sideLabel})]\n${pin.text}`;
    })
    .join("\n\n---\n\n");
}

export function pinnedFilePaths(pins: ChatPinInput[]): string[] {
  return [...new Set(pins.map((pin) => pin.filePath))];
}
