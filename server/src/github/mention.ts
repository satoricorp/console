import type postgres from "postgres";
import { handleTxMention } from "../gx-mention/handler";
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
    /** Convex user id of the commenter, when org_members can map them. */
    userId?: string | null;
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
    Events.GxMentionHandled,
    {
      bookmark_id: input.bookmarkId,
      comment_id: input.commentId,
      author: input.author,
      user_id: input.userId ?? null,
      model: result.replyModel,
      vetoed_rule_text: result.vetoedRuleText,
      retired_rule_count: result.retiredRuleIds.length,
      replied: true,
    },
    input.orgId,
  );

  let postedCommentId: number | null = null;
  try {
    const token = await getInstallationAccessToken(input.installationId);
    if (
      input.replyMode === "review" &&
      typeof input.githubCommentId === "number"
    ) {
      const posted = await postPullRequestReviewReply(
        token,
        input.repoFullName,
        input.pullNumber,
        result.reply,
        input.githubCommentId,
      );
      postedCommentId = posted.id;
    } else {
      const posted = await postIssueComment(
        token,
        input.repoFullName,
        input.pullNumber,
        result.reply,
      );
      postedCommentId = posted.id;
    }
  } catch (error) {
    console.error("Failed to post @gx reply", { error, commentId: input.commentId });
  }

  // Persist gx's own turn beside the human comment so chat is countable per
  // conversation. Recorded even when the GitHub post fails (the completion
  // still ran); best-effort — never fails the webhook path.
  try {
    await db`
      INSERT INTO pr_comments (
        org_id,
        bookmark_id,
        github_comment_id,
        author,
        body,
        file,
        line,
        in_reply_to,
        is_gx_mention,
        model,
        created_at_ms
      ) VALUES (
        ${input.orgId},
        ${input.bookmarkId},
        ${postedCommentId},
        'gx',
        ${result.reply},
        ${input.replyMode === "review" ? (input.file ?? null) : null},
        ${input.replyMode === "review" ? (input.line ?? null) : null},
        ${input.githubCommentId ?? null},
        false,
        ${result.replyModel},
        ${Date.now()}
      )
    `;
  } catch (error) {
    console.error("Failed to persist @gx reply", { error, commentId: input.commentId });
  }
}
