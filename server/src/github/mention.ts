import type postgres from "postgres";
import { handleTxMention } from "../tx-mention/handler";
import { capture, Events } from "../telemetry/posthog";
import { getInstallationAccessToken } from "./app";
import { postIssueComment, postPullRequestReviewReply } from "./comments";

export async function processTxMention(
  db: postgres.Sql,
  input: {
    orgId: string;
    bookmarkId: string;
    commentId: string;
    author: string;
    body: string;
    file?: string | null;
    line?: number | null;
    installationId: number;
    repoFullName: string;
    pullNumber: number;
    githubCommentId?: number;
    replyMode: "issue" | "review";
  },
) {
  const result = await handleTxMention(db, {
    orgId: input.orgId,
    bookmarkId: input.bookmarkId,
    commentId: input.commentId,
    author: input.author,
    body: input.body,
    file: input.file ?? null,
    line: input.line ?? null,
    github: {
      installationId: input.installationId,
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
    },
  });

  if (!result.reply) {
    return;
  }

  capture(
    Events.TxMentionHandled,
    {
      bookmark_id: input.bookmarkId,
      comment_id: input.commentId,
      author: input.author,
      vetoed_rule_text: result.vetoedRuleText,
      retired_rule_count: result.retiredRuleIds.length,
      replied: true,
    },
    input.orgId,
  );

  try {
    const token = await getInstallationAccessToken(input.installationId);
    if (
      input.replyMode === "review" &&
      typeof input.githubCommentId === "number"
    ) {
      await postPullRequestReviewReply(
        token,
        input.repoFullName,
        input.pullNumber,
        result.reply,
        input.githubCommentId,
      );
    } else {
      await postIssueComment(
        token,
        input.repoFullName,
        input.pullNumber,
        result.reply,
      );
    }
  } catch (error) {
    console.error("Failed to post @tx reply", { error, commentId: input.commentId });
  }
}
