import type postgres from "postgres";
import { findOrCreateBookmark } from "../bookmarks/adoption";
import { containsTxMention } from "../tx-mention/handler";
import { classifyReviewComment, type ClassifyInput } from "../rules/classifier";
import { resolveOrgIdForInstallation } from "./app";
import { processTxMention } from "./mention";
import type { GitHubComment } from "./webhook";

export async function ingestLineComment(
  db: postgres.Sql,
  input: {
    installationId: number;
    repoFullName: string;
    pullNumber: number;
    branchName: string;
    prUrl: string | null;
    headSha: string | null;
    comment: GitHubComment;
    reviewState: ClassifyInput["reviewState"];
    webhookAction: string;
  },
) {
  const orgId = await resolveOrgIdForInstallation(db, input.installationId);
  if (!orgId) return;

  const body = input.comment.body?.trim() ?? "";
  const author = input.comment.user?.login ?? "unknown";
  const isTx = containsTxMention(body);

  if (typeof input.comment.id === "number") {
    const [existing] = await db<{ id: string; bookmark_id: string; author: string }[]>`
      SELECT id, bookmark_id, author
      FROM pr_comments
      WHERE org_id = ${orgId}
        AND github_comment_id = ${input.comment.id}
      LIMIT 1
    `;
    if (existing) {
      if (input.webhookAction === "edited" && isTx) {
        await processTxMention(db, {
          orgId,
          bookmarkId: existing.bookmark_id,
          commentId: existing.id,
          author: existing.author,
          body,
          file: input.comment.path ?? null,
          line: input.comment.line ?? null,
          installationId: input.installationId,
          repoFullName: input.repoFullName,
          pullNumber: input.pullNumber,
          githubCommentId: input.comment.id,
          replyMode: input.comment.path ? "review" : "issue",
        });
      }
      return;
    }
  }

  const bookmark = await findOrCreateBookmark(db, {
    orgId,
    repoFullName: input.repoFullName,
    branchName: input.branchName,
    prNumber: input.pullNumber,
    prUrl: input.prUrl,
    headSha: input.headSha,
  });

  const now = Date.now();

  const [row] = await db<{ id: string }[]>`
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
      created_at_ms
    ) VALUES (
      ${orgId},
      ${bookmark.id},
      ${input.comment.id ?? null},
      ${author},
      ${body},
      ${input.comment.path ?? null},
      ${input.comment.line ?? null},
      ${input.comment.in_reply_to_id ?? null},
      ${isTx},
      ${now}
    )
    RETURNING id
  `;

  await persistClassification(db, {
    orgId,
    bookmarkId: bookmark.id,
    commentId: row.id,
    reviewer: author,
    body,
    reviewState: input.reviewState,
    repoScope: input.repoFullName,
  });

  if (isTx) {
    await processTxMention(db, {
      orgId,
      bookmarkId: bookmark.id,
      commentId: row.id,
      author,
      body,
      file: input.comment.path ?? null,
      line: input.comment.line ?? null,
      installationId: input.installationId,
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
      githubCommentId: input.comment.id,
      replyMode: input.comment.path ? "review" : "issue",
    });
  }
}

export async function persistClassification(
  db: postgres.Sql,
  input: {
    orgId: string;
    bookmarkId: string;
    commentId: string;
    reviewer: string;
    body: string;
    reviewState: ClassifyInput["reviewState"];
    repoScope: string;
  },
) {
  const classified = classifyReviewComment({
    body: input.body,
    reviewer: input.reviewer,
    reviewState: input.reviewState,
    repoScope: input.repoScope,
  });

  const now = Date.now();
  await db`
    INSERT INTO decisions (
      org_id, bookmark_id, reviewer, action, source_comment_id, extracted_reason, created_at_ms
    ) VALUES (
      ${input.orgId},
      ${input.bookmarkId},
      ${input.reviewer},
      ${classified.decision.action},
      ${input.commentId},
      ${classified.decision.extractedReason},
      ${now}
    )
  `;

  for (const rule of classified.rules) {
    await db`
      INSERT INTO rules (
        org_id,
        repo_scope,
        rule_text,
        scope_expr,
        strength,
        status,
        source_comment_id,
        created_at_ms
      ) VALUES (
        ${input.orgId},
        ${input.repoScope},
        ${rule.ruleText},
        ${rule.scopeExpr},
        ${rule.strength},
        'inferred',
        ${input.commentId},
        ${now}
      )
    `;
  }
}
