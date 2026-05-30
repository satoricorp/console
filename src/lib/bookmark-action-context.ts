import { buildPrChatContext, buildSessionSummaryForPins } from "../../convex/lib/prChatContext";
import { headCommitIdFromPayload } from "../../convex/lib/gxPrPayload";
import type { PublishContext } from "../../convex/lib/bookmarkActionContext";
import type { ChatPin } from "@/lib/chat-pin";
import type { ConsoleBookmark } from "@/lib/bookmarks-client";
import { extractMergeTarget } from "@/lib/gx-pr-payload";

export function publishContextFromBookmark(
  meta: ConsoleBookmark,
  payload: unknown,
): PublishContext {
  const target = extractMergeTarget(payload, meta.repoFullName);
  if (!target) {
    throw new Error(
      "This bookmark is missing repo or branch metadata required for GitHub.",
    );
  }

  return {
    repoFullName: target.repoFullName,
    headBranch: target.headBranch,
    baseBranch: target.baseBranch,
    localHeadSha: meta.headCommitId ?? headCommitIdFromPayload(payload),
  };
}

export function prChatContextFromBookmark(
  meta: ConsoleBookmark,
  payload: unknown,
  pins: ChatPin[] = [],
) {
  const prContext = buildPrChatContext(payload);
  const pinnedFiles = [...new Set(pins.map((pin) => pin.filePath))];
  const sessionSummary =
    buildSessionSummaryForPins(payload, pinnedFiles) ?? prContext.sessionSummary;

  return {
    repoFullName: meta.repoFullName,
    branchName: meta.branchName,
    title: meta.title ?? undefined,
    prChatContext: {
      changedFiles: prContext.changedFiles,
      prBody: prContext.prBody,
      sessionSummary,
    },
  };
}
