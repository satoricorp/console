"use client";

import type { DiffLineAnnotation, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  extractFileDiffs,
  extractPaths,
  fileDiffMatchesSelection,
} from "@/lib/gx-pr-payload";
import { chatPinFromDiffSelection, chatPinFromPending, type ChatPin } from "@/lib/chat-pin";
import {
  annotationsForFile,
  createDiffComment,
  pendingFromChatPin,
  pendingSelectionRange,
  type DiffComment,
  type DiffCommentAnnotationMeta,
  type PendingDiffComment,
} from "@/lib/diff-comment";
import { pathsEqual } from "@/lib/move-selection";
import { renderDiffCommentAnnotation } from "./diff-inline-comment";
import { usePrReviewWorkspace } from "./pr-review-workspace";

type PrPushPreviewProps = {
  payload: unknown;
};

const diffAnnotationCss = `
[data-annotation-slot] {
  padding: 8px 12px 12px;
  box-sizing: border-box;
}
`;

const diffOptions = {
  theme: "pierre-dark",
  diffStyle: "split",
  enableLineSelection: true,
  unsafeCSS: diffAnnotationCss,
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
  comments,
  pendingComment,
  onBeginComment,
  onSaveComment,
  onCancelComment,
  onDeleteComment,
  onPinToChat,
}: {
  fileDiff: FileDiffMetadata;
  comments: DiffComment[];
  pendingComment: PendingDiffComment | null;
  onBeginComment: (pending: PendingDiffComment) => void;
  onSaveComment: (comment: DiffComment) => void;
  onCancelComment: () => void;
  onDeleteComment: (commentId: string) => void;
  onPinToChat?: (pin: ChatPin, message: string) => void;
}) {
  const lineAnnotations = useMemo(
    () => annotationsForFile(fileDiff.name, comments, pendingComment),
    [comments, fileDiff.name, pendingComment],
  );

  const selectedLines = useMemo((): SelectedLineRange | null => {
    if (
      pendingComment == null ||
      pendingComment.filePath !== fileDiff.name
    ) {
      return null;
    }
    return pendingSelectionRange(pendingComment);
  }, [fileDiff.name, pendingComment]);

  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      if (!range) return;
      onBeginComment(pendingFromChatPin(chatPinFromDiffSelection(fileDiff, range)));
    },
    [fileDiff, onBeginComment],
  );

  const handleSaveDraft = useCallback(
    (body: string) => {
      if (pendingComment == null) return;
      onSaveComment(createDiffComment(pendingComment, body));
    },
    [onSaveComment, pendingComment],
  );

  const handlePinDraftToChat = useCallback(
    (body: string) => {
      if (!onPinToChat || pendingComment == null) return;
      onPinToChat(chatPinFromPending(pendingComment), body);
    },
    [onPinToChat, pendingComment],
  );

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<DiffCommentAnnotationMeta>) =>
      renderDiffCommentAnnotation(annotation, {
        pending: pendingComment,
        onSaveDraft: handleSaveDraft,
        onCancelDraft: onCancelComment,
        onPinDraftToChat: onPinToChat ? handlePinDraftToChat : undefined,
        onDeleteComment,
      }),
    [
      handlePinDraftToChat,
      handleSaveDraft,
      onPinToChat,
      onCancelComment,
      onDeleteComment,
      pendingComment,
    ],
  );

  return (
    <FileDiff
      key={fileDiff.name}
      fileDiff={fileDiff}
      lineAnnotations={lineAnnotations}
      selectedLines={selectedLines}
      renderAnnotation={renderAnnotation}
      options={{
        ...diffOptions,
        onLineSelectionEnd: handleLineSelectionEnd,
      }}
    />
  );
}

export function PrPushPreview({
  payload,
}: PrPushPreviewProps) {
  const {
    diffComments,
    pendingComment,
    beginComment,
    saveComment,
    cancelComment,
    deleteComment,
    pinToChat,
    reportFileSelection,
  } = usePrReviewWorkspace();
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
  const lastReportedPathsRef = useRef<string[]>([]);

  useEffect(() => {
    treeModel.resetPaths(changedPaths);
  }, [treeModel, changedPaths]);

  useEffect(() => {
    const paths = [...selectedPaths];
    if (pathsEqual(lastReportedPathsRef.current, paths)) return;
    lastReportedPathsRef.current = paths;
    reportFileSelection(paths);
  }, [reportFileSelection, selectedPaths]);

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
                comments={diffComments}
                pendingComment={pendingComment}
                onBeginComment={beginComment}
                onSaveComment={saveComment}
                onCancelComment={cancelComment}
                onDeleteComment={deleteComment}
                onPinToChat={pinToChat}
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
