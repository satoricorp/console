import { Hono } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import { containsGxMention, handleGxMention } from "../gx-mention/handler";
import { enqueueIndexJob } from "../indexing/jobs";
import { QuotaExceededError } from "../metering/quota";
import { detectOutcomeStub } from "../outcomes/stub";
import { classifyReviewComment, type ClassifyInput } from "../rules/classifier";
import { generateSummary } from "../summary/generate";
import { createLLMProvider } from "../llm/provider";
import { capture, Events } from "../telemetry/posthog";
import {
  getInstallationAccessToken,
  resolveOrgIdForInstallation,
  verifyGitHubWebhookSignature,
} from "./app";
import { bootstrapInstallationMembership } from "../orgs/members";
import { postIssueComment, postPullRequestReviewReply } from "./comments";
import { updatePullRequestWithSummary } from "./pr-body";

export const githubWebhookRoutes = new Hono();

type GitHubAccount = {
  id?: number;
  login?: string;
  type?: string;
};

type GitHubRepository = {
  id?: number;
  full_name?: string;
  name?: string;
  private?: boolean;
  default_branch?: string;
  owner?: GitHubAccount;
};

type GitHubInstallation = {
  id?: number;
  account?: GitHubAccount;
  repository_selection?: string;
  app_id?: number;
  created_at?: string;
  suspended_at?: string | null;
};

type GitHubUser = {
  id?: number;
  login?: string;
};

type GitHubPullRequest = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  merged?: boolean;
  merged_at?: string | null;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
};

type GitHubReview = {
  id?: number;
  user?: GitHubUser;
  body?: string | null;
  state?: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  submitted_at?: string;
};

type GitHubComment = {
  id?: number;
  user?: GitHubUser;
  body?: string;
  path?: string;
  line?: number;
  in_reply_to_id?: number;
};

type WebhookPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repositories?: GitHubRepository[];
  repositories_added?: GitHubRepository[];
  repositories_removed?: GitHubRepository[];
  repository?: GitHubRepository;
  sender?: GitHubUser;
  pull_request?: GitHubPullRequest;
  review?: GitHubReview;
  comment?: GitHubComment;
  issue?: { number?: number; pull_request?: Record<string, unknown> };
  ref?: string;
  after?: string;
  commits?: Array<{ message?: string }>;
};

githubWebhookRoutes.post("/github/webhook", async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header("X-Hub-Signature-256");
  if (!verifyGitHubWebhookSignature(payload, signature)) {
    return c.json({ error: "Invalid webhook signature" }, 401);
  }

  const event = c.req.header("X-GitHub-Event") ?? "";
  const delivery = c.req.header("X-GitHub-Delivery") ?? "";
  let body: WebhookPayload;
  try {
    body = JSON.parse(payload) as WebhookPayload;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    if (event === "ping") {
      return c.json({ ok: true, event, delivery });
    }

    const db = getSql();
    switch (event) {
      case "installation":
        await handleInstallation(db, body);
        break;
      case "installation_repositories":
        await handleInstallationRepositories(db, body);
        break;
      case "pull_request":
        await handlePullRequest(db, body);
        break;
      case "pull_request_review":
        await handlePullRequestReview(db, body);
        break;
      case "pull_request_review_comment":
        await handlePullRequestReviewComment(db, body);
        break;
      case "issue_comment":
        await handleIssueComment(db, body);
        break;
      case "push":
        await handlePush(db, body);
        await forwardPushToConvex(payload, signature);
        break;
      default:
        return c.json({ ok: true, ignored: true, event, delivery });
    }

    capture(
      Events.GitHubWebhook,
      { event_type: event, delivery },
      await distinctIdForWebhook(db, body),
    );

    return c.json({ ok: true, event, delivery });
  } catch (error) {
    console.error("GitHub webhook handling failed", { event, delivery, error });
    return c.json({ error: "Webhook handling failed" }, 500);
  }
});

async function handleInstallation(db: postgres.Sql, payload: WebhookPayload) {
  const installation = normalizeInstallation(payload.installation);
  if (!installation) return;

  const now = Date.now();
  const action = payload.action ?? "";
  const removed = action === "deleted";
  const senderGithubUserId =
    typeof payload.sender?.id === "number" ? payload.sender.id : null;

  await db.begin(async (tx) => {
    await upsertInstallation(tx, installation, now);

    if (removed) {
      await tx`
        UPDATE github_app_repositories
        SET access_state = 'removed',
            removed_at_ms = ${now},
            updated_at_ms = ${now}
        WHERE installation_id = ${installation.installationId}
      `;
      return;
    }

    await upsertOrgForInstallation(tx, installation.installationId, now);

    for (const repo of payload.repositories ?? []) {
      const normalized = normalizeRepository(repo, installation.installationId);
      if (normalized) {
        await upsertRepository(tx, normalized, now);
      }
    }
  });

  if (!removed) {
    const orgId = await resolveOrgIdForInstallation(db, installation.installationId);
    if (orgId) {
      await bootstrapInstallationMembership(db, {
        orgId,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        accountId: installation.accountId,
        senderGithubUserId,
      });
      for (const repo of payload.repositories ?? []) {
        if (!repo.full_name) continue;
        enqueueIndexJob({
          orgId,
          repoFullName: repo.full_name,
          reason: "install",
          ref: repo.default_branch ? `refs/heads/${repo.default_branch}` : undefined,
        });
      }
    }
  }
}

async function handleInstallationRepositories(
  db: postgres.Sql,
  payload: WebhookPayload,
) {
  const installation = normalizeInstallation(payload.installation);
  if (!installation) return;

  const now = Date.now();
  await db.begin(async (tx) => {
    await upsertInstallation(tx, installation, now);
    await upsertOrgForInstallation(tx, installation.installationId, now);

    for (const repo of payload.repositories_added ?? []) {
      const normalized = normalizeRepository(repo, installation.installationId);
      if (normalized) {
        await upsertRepository(tx, normalized, now);
      }
    }

    for (const repo of payload.repositories_removed ?? []) {
      if (typeof repo.id !== "number") continue;
      await tx`
        UPDATE github_app_repositories
        SET access_state = 'removed',
            removed_at_ms = ${now},
            updated_at_ms = ${now}
        WHERE github_repo_id = ${repo.id}
      `;
    }
  });
}

async function handlePullRequest(db: postgres.Sql, payload: WebhookPayload) {
  const action = payload.action ?? "";
  if (action === "closed") {
    await handlePullRequestClosed(db, payload);
    return;
  }
  if (action !== "opened" && action !== "synchronize") {
    return;
  }

  const installationId = payload.installation?.id;
  const repo = payload.repository;
  const pr = payload.pull_request;
  if (typeof installationId !== "number" || !repo?.full_name || typeof pr?.number !== "number") {
    return;
  }

  const orgId = await resolveOrgIdForInstallation(db, installationId);
  if (!orgId) {
    return;
  }

  const bookmark = await findOrCreateBookmark(db, {
    orgId,
    repoFullName: repo.full_name,
    branchName: pr.head?.ref ?? `pr-${pr.number}`,
    prNumber: pr.number,
    prUrl: pr.html_url ?? null,
    headSha: pr.head?.sha ?? null,
  });

  const resolved = await adoptLatestEventFromBranchSibling(db, {
    orgId,
    bookmarkId: bookmark.id,
    repoFullName: repo.full_name,
    branchName: pr.head?.ref ?? `pr-${pr.number}`,
    latestEventId: bookmark.latest_event_id,
  });

  if (!resolved.latest_event_id) {
    console.info("PR Summary skipped: bookmark has no latest_event_id", {
      bookmarkId: bookmark.id,
    });
    return;
  }

  const publisherUserId = await resolveEventPublisherUserId(
    db,
    orgId,
    resolved.latest_event_id,
  );

  let result;
  try {
    result = await generateSummary(db, {
      orgId,
      userId: publisherUserId,
      bookmarkId: resolved.id,
      provider: createLLMProvider(),
      quotaSkipSource: "github_webhook",
      quotaSkipPrNumber: pr.number,
      quotaSkipRepoFullName: repo.full_name,
      githubPrUrl: pr.html_url ?? null,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      console.info("PR Summary skipped: not posting to GitHub", {
        orgId,
        bookmarkId: resolved.id,
        reason: "trial_expired",
        source: "github_webhook",
      });
      return;
    }
    throw error;
  }

  let bodyUpdated = false;
  let postedOk = false;
  let postedBody = result.content;
  try {
    const token = await getInstallationAccessToken(installationId);
    const posted = await updatePullRequestWithSummary(
      token,
      repo.full_name,
      pr.number,
      result.content,
    );
    bodyUpdated = posted.updated;
    postedBody = posted.body;
    postedOk = true;
  } catch (error) {
    console.error("Failed to update PR Summary body", {
      orgId,
      bookmarkId: bookmark.id,
      error,
    });
  }

  capture(
    Events.SummaryPosted,
    {
      bookmark_id: bookmark.id,
      event_id: result.eventId,
      summary_id: result.summaryId,
      pr_number: pr.number,
      repo: repo.full_name,
      github_comment_id: null,
      posted: postedOk,
      body_updated: bodyUpdated,
      target: "pr_body",
    },
    orgId,
  );

  if (!postedOk) {
    return;
  }

  const now = Date.now();
  await db`
    INSERT INTO pr_comments (
      org_id, bookmark_id, github_comment_id, author, body, is_gx_mention, created_at_ms
    ) VALUES (
      ${orgId},
      ${bookmark.id},
      ${null},
      'gx',
      ${postedBody},
      false,
      ${now}
    )
  `;
}

async function resolveEventPublisherUserId(
  db: postgres.Sql,
  orgId: string,
  eventId: string,
): Promise<string> {
  const [event] = await db<
    { user_id: string | null; github_user_id: number | null }[]
  >`
    SELECT user_id, github_user_id
    FROM pr_events
    WHERE id = ${eventId}::uuid
      AND org_id = ${orgId}::uuid
    LIMIT 1
  `;
  const userId = event?.user_id?.trim();
  if (userId && userId !== "github-webhook" && !userId.startsWith("github:")) {
    return userId;
  }
  if (typeof event?.github_user_id === "number") {
    const [member] = await db<{ convex_user_id: string | null }[]>`
      SELECT convex_user_id
      FROM org_members
      WHERE org_id = ${orgId}::uuid
        AND github_user_id = ${event.github_user_id}
      LIMIT 1
    `;
    if (member?.convex_user_id?.trim()) {
      return member.convex_user_id.trim();
    }
  }
  return userId || "github-webhook";
}

/** Sync bookmark merge_status when a PR is closed on GitHub (merge or close). */
async function handlePullRequestClosed(db: postgres.Sql, payload: WebhookPayload) {
  const repo = payload.repository;
  const pr = payload.pull_request;
  if (!repo?.full_name || typeof pr?.number !== "number") {
    return;
  }

  const mergeStatus = pr.merged === true ? "merged" : "closed";
  const now = Date.now();
  const branchName = pr.head?.ref ?? null;

  // Match by repo + PR (or branch when PR number was never stored). Do not
  // require org_id — publish may have filed the bookmark under a different org
  // than the installation org, which previously left merge_status stuck open.
  const updated =
    mergeStatus === "merged"
      ? await db`
          UPDATE bookmarks
          SET
            merge_status = 'merged',
            merged_at_ms = ${
              (typeof pr.merged_at === "string" ? Date.parse(pr.merged_at) : now) ||
              now
            },
            github_pr_url = COALESCE(bookmarks.github_pr_url, ${pr.html_url ?? null}),
            github_pr_number = COALESCE(bookmarks.github_pr_number, ${pr.number}),
            updated_at_ms = ${now}
          WHERE repo_full_name = ${repo.full_name}
            AND (
              github_pr_number = ${pr.number}
              OR (
                github_pr_number IS NULL
                AND ${branchName}::text IS NOT NULL
                AND branch_name = ${branchName}
              )
            )
        `
      : await db`
          UPDATE bookmarks
          SET
            merge_status = 'closed',
            github_pr_url = COALESCE(bookmarks.github_pr_url, ${pr.html_url ?? null}),
            github_pr_number = COALESCE(bookmarks.github_pr_number, ${pr.number}),
            updated_at_ms = ${now}
          WHERE repo_full_name = ${repo.full_name}
            AND (
              github_pr_number = ${pr.number}
              OR (
                github_pr_number IS NULL
                AND ${branchName}::text IS NOT NULL
                AND branch_name = ${branchName}
              )
            )
        `;

  if (updated.count === 0) {
    console.info("PR closed webhook: no bookmark matched", {
      repo: repo.full_name,
      prNumber: pr.number,
      branchName,
      mergeStatus,
    });
  }
}

async function handlePullRequestReview(db: postgres.Sql, payload: WebhookPayload) {
  const review = payload.review;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = payload.installation?.id;
  if (
    !review ||
    typeof installationId !== "number" ||
    !repo?.full_name ||
    typeof pr?.number !== "number"
  ) {
    return;
  }

  const orgId = await resolveOrgIdForInstallation(db, installationId);
  if (!orgId) return;

  const bookmark = await findOrCreateBookmark(db, {
    orgId,
    repoFullName: repo.full_name,
    branchName: pr.head?.ref ?? `pr-${pr.number}`,
    prNumber: pr.number,
    prUrl: pr.html_url ?? null,
    headSha: pr.head?.sha ?? null,
  });

  const body = review.body?.trim() ?? "";
  const author = review.user?.login ?? "unknown";
  const now = Date.now();

  const [comment] = await db<{ id: string }[]>`
    INSERT INTO pr_comments (
      org_id, bookmark_id, github_comment_id, author, body, is_gx_mention, created_at_ms
    ) VALUES (
      ${orgId},
      ${bookmark.id},
      ${review.id ?? null},
      ${author},
      ${body || "(review)"},
      ${containsGxMention(body)},
      ${now}
    )
    RETURNING id
  `;

  const reviewState =
    review.state === "approved" ||
    review.state === "changes_requested" ||
    review.state === "commented"
      ? review.state
      : null;

  await persistClassification(db, {
    orgId,
    bookmarkId: bookmark.id,
    commentId: comment.id,
    reviewer: author,
    body,
    reviewState,
    repoScope: repo.full_name,
  });

  if (containsGxMention(body)) {
    await processGxMention(db, {
      orgId,
      bookmarkId: bookmark.id,
      commentId: comment.id,
      author,
      body,
      file: null,
      line: null,
      installationId,
      repoFullName: repo.full_name,
      pullNumber: pr.number,
      githubCommentId: review.id,
      replyMode: "issue",
    });
  }
}

async function handlePullRequestReviewComment(
  db: postgres.Sql,
  payload: WebhookPayload,
) {
  const action = payload.action ?? "";
  if (!shouldProcessCommentWebhook(action)) {
    return;
  }

  const comment = payload.comment;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = payload.installation?.id;
  if (
    !comment ||
    typeof installationId !== "number" ||
    !repo?.full_name ||
    typeof pr?.number !== "number"
  ) {
    return;
  }
  if (isGithubBot(comment.user?.login)) {
    return;
  }

  await ingestLineComment(db, {
    installationId,
    repoFullName: repo.full_name,
    pullNumber: pr.number,
    branchName: pr.head?.ref ?? `pr-${pr.number}`,
    prUrl: pr.html_url ?? null,
    headSha: pr.head?.sha ?? null,
    comment,
    reviewState: null as ClassifyInput["reviewState"],
    webhookAction: action,
  });
}

async function handleIssueComment(db: postgres.Sql, payload: WebhookPayload) {
  if (!payload.issue?.pull_request) {
    return;
  }

  const action = payload.action ?? "";
  if (!shouldProcessCommentWebhook(action)) {
    return;
  }

  const comment = payload.comment;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = payload.installation?.id;
  const issueNumber = payload.issue.number ?? pr?.number;
  if (
    !comment ||
    typeof installationId !== "number" ||
    !repo?.full_name ||
    typeof issueNumber !== "number"
  ) {
    return;
  }
  if (isGithubBot(comment.user?.login)) {
    return;
  }

  await ingestLineComment(db, {
    installationId,
    repoFullName: repo.full_name,
    pullNumber: issueNumber,
    branchName: pr?.head?.ref ?? `pr-${issueNumber}`,
    prUrl: pr?.html_url ?? null,
    headSha: pr?.head?.sha ?? null,
    comment,
    reviewState: null as ClassifyInput["reviewState"],
    webhookAction: action,
  });
}

// forwardPushToConvex hands the delivery on to the Convex indexer.
//
// A GitHub App has exactly one webhook URL, and this server is it. The only
// thing that indexes repository source lives in Convex, behind
// /cx/github/webhook, so until this forward existed that indexer received
// nothing: `handlePush` below writes push metadata and hunk links, never file
// contents. The result was that no repository was ever re-indexed on merge.
//
// The delivery is forwarded verbatim — same bytes, same signature header — so
// Convex verifies exactly what GitHub signed rather than trusting this server.
// A failure here must not fail the delivery back to GitHub: the metadata work
// has already succeeded, and GitHub's retry would repeat it.
async function forwardPushToConvex(payload: string, signature: string | undefined) {
  const base = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  if (!base || !signature) {
    return;
  }
  try {
    const response = await fetch(`${base}/cx/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": signature,
      },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("forward push to convex failed", {
        status: response.status,
        body: (await response.text().catch(() => "")).slice(0, 500),
      });
    }
  } catch (error) {
    console.error("forward push to convex threw", error);
  }
}

async function handlePush(db: postgres.Sql, payload: WebhookPayload) {
  const repo = payload.repository;
  const installationId = payload.installation?.id;
  if (!repo?.full_name || typeof installationId !== "number") {
    return;
  }

  const orgId = await resolveOrgIdForInstallation(db, installationId);
  detectOutcomeStub({
    orgId: orgId ?? "unknown",
    bookmarkId: "unknown",
    repoFullName: repo.full_name,
    ref: payload.ref,
    commitMessage: payload.commits?.[0]?.message,
  });

  if (orgId) {
    enqueueIndexJob({
      orgId,
      repoFullName: repo.full_name,
      reason: "push",
      ref: payload.ref,
      afterSha: payload.after,
      commitMessages: payload.commits?.map((c) => c.message).filter(Boolean) as string[] | undefined,
    });
  }
}

async function ingestLineComment(
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
  const isGx = containsGxMention(body);

  if (typeof input.comment.id === "number") {
    const [existing] = await db<{ id: string; bookmark_id: string; author: string }[]>`
      SELECT id, bookmark_id, author
      FROM pr_comments
      WHERE org_id = ${orgId}
        AND github_comment_id = ${input.comment.id}
      LIMIT 1
    `;
    if (existing) {
      if (input.webhookAction === "edited" && isGx) {
        await processGxMention(db, {
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
      ${isGx},
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

  if (isGx) {
    await processGxMention(db, {
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

async function persistClassification(
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

async function processGxMention(
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
  const result = await handleGxMention(db, {
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
    console.error("Failed to post @gx reply", { error, commentId: input.commentId });
  }
}

async function findOrCreateBookmark(
  db: postgres.Sql,
  input: {
    orgId: string;
    repoFullName: string;
    branchName: string;
    prNumber: number;
    prUrl: string | null;
    headSha: string | null;
  },
): Promise<{ id: string; latest_event_id: string | null }> {
  const [existing] = await db<{ id: string; latest_event_id: string | null }[]>`
    SELECT id, latest_event_id
    FROM bookmarks
    WHERE org_id = ${input.orgId}
      AND repo_full_name = ${input.repoFullName}
      AND github_pr_number = ${input.prNumber}
    ORDER BY updated_at_ms DESC
    LIMIT 1
  `;
  if (existing) {
    return existing;
  }

  const now = Date.now();

  // A CLI publish for this branch creates a bookmark before the PR exists
  // (and so without a PR number). Claim it rather than minting a second
  // bookmark, so the PR keeps the publish event evidence.
  const [claimed] = await db<{ id: string; latest_event_id: string | null }[]>`
    UPDATE bookmarks
    SET github_pr_number = ${input.prNumber},
        github_pr_url = COALESCE(${input.prUrl}, bookmarks.github_pr_url),
        remote_head_sha = COALESCE(${input.headSha}, bookmarks.remote_head_sha),
        updated_at_ms = ${now}
    WHERE id = (
      SELECT id FROM bookmarks
      WHERE org_id = ${input.orgId}
        AND repo_full_name = ${input.repoFullName}
        AND branch_name = ${input.branchName}
        AND github_pr_number IS NULL
      ORDER BY updated_at_ms DESC
      LIMIT 1
    )
    RETURNING id, latest_event_id
  `;
  if (claimed) {
    return claimed;
  }
  const [created] = await db<{ id: string; latest_event_id: string | null }[]>`
    INSERT INTO bookmarks (
      user_id,
      repo_full_name,
      branch_name,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      published_at_ms,
      updated_at_ms,
      org_id
    ) VALUES (
      'github-webhook',
      ${input.repoFullName},
      ${input.branchName},
      ${input.prUrl},
      ${input.prNumber},
      ${input.headSha},
      ${now},
      ${now},
      ${input.orgId}
    )
    RETURNING id, latest_event_id
  `;
  return created;
}

async function adoptLatestEventFromBranchSibling(
  db: postgres.Sql,
  input: {
    orgId: string;
    bookmarkId: string;
    repoFullName: string;
    branchName: string;
    latestEventId: string | null;
  },
): Promise<{ id: string; latest_event_id: string | null }> {
  if (input.latestEventId) {
    return { id: input.bookmarkId, latest_event_id: input.latestEventId };
  }

  const [sibling] = await db<
    { id: string; latest_event_id: string; head_commit_id: string | null }[]
  >`
    SELECT id, latest_event_id, head_commit_id
    FROM bookmarks
    WHERE org_id = ${input.orgId}
      AND repo_full_name = ${input.repoFullName}
      AND branch_name = ${input.branchName}
      AND latest_event_id IS NOT NULL
      AND id <> ${input.bookmarkId}
    ORDER BY updated_at_ms DESC
    LIMIT 1
  `;
  if (!sibling) {
    return { id: input.bookmarkId, latest_event_id: null };
  }

  const now = Date.now();
  const [updated] = await db<{ id: string; latest_event_id: string | null }[]>`
    UPDATE bookmarks
    SET latest_event_id = ${sibling.latest_event_id},
        head_commit_id = COALESCE(bookmarks.head_commit_id, ${sibling.head_commit_id}),
        updated_at_ms = ${now}
    WHERE id = ${input.bookmarkId}
    RETURNING id, latest_event_id
  `;
  console.info("PR Summary adopted latest_event_id from branch sibling", {
    bookmarkId: input.bookmarkId,
    siblingId: sibling.id,
    eventId: sibling.latest_event_id,
  });
  return updated ?? { id: input.bookmarkId, latest_event_id: sibling.latest_event_id };
}

async function upsertOrgForInstallation(
  tx: postgres.TransactionSql,
  installationId: number,
  now: number,
) {
  await tx`
    INSERT INTO orgs (installation_id, created_at_ms)
    VALUES (${installationId}, ${now})
    ON CONFLICT (installation_id) DO NOTHING
  `;
}

async function upsertInstallation(
  tx: postgres.TransactionSql,
  installation: NonNullable<ReturnType<typeof normalizeInstallation>>,
  now: number,
) {
  await tx`
    INSERT INTO github_app_installations (
      installation_id,
      account_id,
      account_login,
      account_type,
      repository_selection,
      app_id,
      installed_at_ms,
      suspended_at_ms,
      updated_at_ms
    ) VALUES (
      ${installation.installationId},
      ${installation.accountId},
      ${installation.accountLogin},
      ${installation.accountType},
      ${installation.repositorySelection},
      ${installation.appId},
      ${installation.installedAtMs},
      ${installation.suspendedAtMs},
      ${now}
    )
    ON CONFLICT (installation_id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      account_login = EXCLUDED.account_login,
      account_type = EXCLUDED.account_type,
      repository_selection = EXCLUDED.repository_selection,
      app_id = EXCLUDED.app_id,
      suspended_at_ms = EXCLUDED.suspended_at_ms,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

function normalizeInstallation(installation?: GitHubInstallation) {
  if (typeof installation?.id !== "number") return null;
  return {
    installationId: installation.id,
    accountId:
      typeof installation.account?.id === "number"
        ? installation.account.id
        : null,
    accountLogin: installation.account?.login ?? "",
    accountType: installation.account?.type ?? "",
    repositorySelection: installation.repository_selection ?? "",
    appId: typeof installation.app_id === "number" ? installation.app_id : null,
    installedAtMs: parseGitHubTimestamp(installation.created_at),
    suspendedAtMs: parseGitHubTimestamp(installation.suspended_at),
  };
}

function normalizeRepository(repo: GitHubRepository, installationId: number) {
  if (typeof repo.id !== "number" || !repo.full_name) return null;
  const [ownerLogin, nameFromFullName] = repo.full_name.split("/");
  return {
    githubRepoId: repo.id,
    installationId,
    fullName: repo.full_name,
    ownerLogin: repo.owner?.login ?? ownerLogin ?? "",
    name: repo.name ?? nameFromFullName ?? "",
    private: repo.private ?? null,
    defaultBranch: repo.default_branch ?? null,
  };
}

async function upsertRepository(
  tx: postgres.TransactionSql,
  repo: NonNullable<ReturnType<typeof normalizeRepository>>,
  now: number,
) {
  await tx`
    INSERT INTO github_app_repositories (
      github_repo_id,
      installation_id,
      full_name,
      owner_login,
      name,
      private,
      default_branch,
      access_state,
      added_at_ms,
      removed_at_ms,
      updated_at_ms
    ) VALUES (
      ${repo.githubRepoId},
      ${repo.installationId},
      ${repo.fullName},
      ${repo.ownerLogin},
      ${repo.name},
      ${repo.private},
      ${repo.defaultBranch},
      'installed',
      ${now},
      NULL,
      ${now}
    )
    ON CONFLICT (github_repo_id) DO UPDATE SET
      installation_id = EXCLUDED.installation_id,
      full_name = EXCLUDED.full_name,
      owner_login = EXCLUDED.owner_login,
      name = EXCLUDED.name,
      private = EXCLUDED.private,
      default_branch = EXCLUDED.default_branch,
      access_state = 'installed',
      removed_at_ms = NULL,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

function parseGitHubTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldProcessCommentWebhook(action: string): boolean {
  return action === "created" || action === "edited";
}

function isGithubBot(login?: string | null): boolean {
  const normalized = (login ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.endsWith("[bot]") || normalized === "gx";
}

async function distinctIdForWebhook(
  db: postgres.Sql,
  body: WebhookPayload,
): Promise<string> {
  const installationId = body.installation?.id;
  if (typeof installationId === "number") {
    const orgId = await resolveOrgIdForInstallation(db, installationId);
    if (orgId) {
      return orgId;
    }
    return String(installationId);
  }
  return "dev";
}
