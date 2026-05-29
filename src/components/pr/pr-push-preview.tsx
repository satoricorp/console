"use client";

import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react";
import { useCallback, useEffect, useMemo } from "react";
import {
  extractFileDiffs,
  extractPaths,
  fileDiffMatchesSelection,
} from "@/lib/gx-pr-payload";
import { chatPinFromDiffSelection, type ChatPin } from "@/lib/chat-pin";

type PrPushPreviewProps = {
  payload: unknown;
  onAddChatPin?: (pin: ChatPin) => void;
};

const diffOptions = {
  theme: "pierre-dark",
  diffStyle: "split",
  enableLineSelection: true,
} as const;

function dedupeFileDiffs(fileDiffs: FileDiffMetadata[]): FileDiffMetadata[] {
  const seen = new Set<string>();
  const unique: FileDiffMetadata[] = [];
  for (const fileDiff of fileDiffs) {
    if (seen.has(fileDiff.name)) continue;
    seen.add(fileDiff.name);
    unique.push(fileDiff);
  }
  return unique;
}

function DiffFilePanel({
  fileDiff,
  onAddChatPin,
}: {
  fileDiff: FileDiffMetadata;
  onAddChatPin?: (pin: ChatPin) => void;
}) {
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      if (!onAddChatPin || !range) return;
      onAddChatPin(chatPinFromDiffSelection(fileDiff, range));
    },
    [fileDiff, onAddChatPin],
  );

  return (
    <FileDiff
      key={fileDiff.name}
      fileDiff={fileDiff}
      options={{
        ...diffOptions,
        onLineSelectionEnd: onAddChatPin ? handleLineSelectionEnd : undefined,
      }}
    />
  );
}

export function PrPushPreview({ payload, onAddChatPin }: PrPushPreviewProps) {
  const fileDiffs = useMemo(
    () => dedupeFileDiffs(extractFileDiffs(payload)),
    [payload],
  );
  const changedPaths = useMemo(() => extractPaths(payload), [payload]);
  const { model: treeModel } = useFileTree({
    paths: changedPaths,
    density: "compact",
    initialExpansion: "open",
  });
  const selectedPaths = useFileTreeSelection(treeModel);

  useEffect(() => {
    treeModel.resetPaths(changedPaths);
  }, [treeModel, changedPaths]);

  const visibleDiffs = useMemo(() => {
    if (fileDiffs.length === 0) {
      return [];
    }
    if (selectedPaths.length === 0) {
      return fileDiffs;
    }
    return fileDiffs.filter((fileDiff) =>
      fileDiffMatchesSelection(fileDiff, selectedPaths),
    );
  }, [fileDiffs, selectedPaths]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <section className="flex min-h-48 w-full flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 lg:w-64 lg:shrink-0">
        <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          trees.computer
        </div>
        {changedPaths.length > 0 ? (
          <FileTree
            model={treeModel}
            className="min-h-0 flex-1 overflow-auto text-sm"
            style={{ height: "100%", minHeight: 240 }}
          />
        ) : (
          <p className="p-4 text-sm text-zinc-500">No changed files in this push.</p>
        )}
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          diffs.com
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-2">
          {visibleDiffs.length > 0 ? (
            visibleDiffs.map((fileDiff) => (
              <DiffFilePanel
                key={fileDiff.name}
                fileDiff={fileDiff}
                onAddChatPin={onAddChatPin}
              />
            ))
          ) : fileDiffs.length > 0 ? (
            <p className="p-4 text-sm text-zinc-500">
              Select a changed file in the tree to preview its diff.
            </p>
          ) : (
            <p className="p-4 text-sm text-zinc-500">
              No patch in payload yet. Push with{" "}
              <code className="text-xs">gx pr</code> and include{" "}
              <code className="text-xs">patch</code> (or{" "}
              <code className="text-xs">diff</code>).
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
