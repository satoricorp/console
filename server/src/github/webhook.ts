import { Hono } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import { adoptLatestEventFromBranchSibling, findOrCreateBookmark } from "../bookmarks/adoption";
import { containsTxMention } from "../gx-mention/handler";
import { enqueueIndexJob } from "../indexing/jobs";
import { looksLikeConvexUserId, QuotaExceededError } from "../metering/quota";
import { resolveConvexUserIdForGithubUser } from "../orgs/members";
import { detectOutcomeStub } from "../outcomes/stub";
import type { ClassifyInput } from "../rules/classifier";
import { generateSummary } from "../summary/generate";
import { createLLMProvider } from "../llm/provider";
import { capture, Events } from "../telemetry/posthog";
import {
  getInstallationAccessToken,
  resolveOrgIdForInstallation,
  verifyGitHubWebhookSignature,
} from "./app";
import { ingestLineComment, persistClassification } from "./comments-ingest";
import { forwardToConvex } from "./convex-forward";
import { handleInstallation, handleInstallationRepositories } from "./installation";
import { processTxMention } from "./mention";
import { updatePullRequestWithSummary, withUnindexedNotice } from "./pr-body";

export const githubWebhookRoutes = new Hono();

// Deliveries the Convex indexer needs. push is what re-indexes a repository on
// merge; the installation pair is how Convex learns which org owns an
// installation, since it has no org table of its own and the namespace it
// writes is gx-{orgId}-{repo}.
const CONVEX_FORWARDED_EVENTS = new Set([
  "push",
  "installation",
  "installation_repositories",
]);

type GitHubAccount = {
  id?: number;
  login?: string;
  type?: string;
};

export type GitHubRepository = {
  id?: number;
  full_name?: string;
  name?: string;
  private?: boolean;
  default_branch?: string;
  owner?: GitHubAccount;
};

export type GitHubInstallation = {
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

export type GitHubComment = {
  id?: number;
  user?: GitHubUser;
  body?: string;
  path?: string;
  line?: number;
  in_reply_to_id?: number;
};

export type WebhookPayload = {
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
        break;
      default:
        return c.json({ ok: true, ignored: true, event, delivery });
    }

    if (CONVEX_FORWARDED_EVENTS.has(event)) {
      const installationId = body.installation?.id;
      const orgId =
        typeof installationId === "number"
          ? await resolveOrgIdForInstallation(db, installationId)
          : null;
      await forwardToConvex(event, payload, signature, orgId);
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
  // The notice must be part of what is actually posted: this used to compute
  // the noticed body and then send result.content, so a summary written blind
  // to the repository read exactly like an informed one on GitHub — the one
  // place the distinction matters.
  let postedBody = withUnindexedNotice(result.content, result.sawIndexedCode);
  try {
    const token = await getInstallationAccessToken(installationId);
    const posted = await updatePullRequestWithSummary(
      token,
      repo.full_name,
      pr.number,
      postedBody,
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
  if (looksLikeConvexUserId(userId)) {
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
  const reviewerUserId = await resolveConvexUserIdForGithubUser(
    db,
    orgId,
    review.user?.id,
  );
  const now = Date.now();

  const [comment] = await db<{ id: string }[]>`
    INSERT INTO pr_comments (
      org_id, bookmark_id, github_comment_id, author, body, is_gx_mention, user_id, created_at_ms
    ) VALUES (
      ${orgId},
      ${bookmark.id},
      ${review.id ?? null},
      ${author},
      ${body || "(review)"},
      ${containsTxMention(body)},
      ${reviewerUserId},
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

  if (containsTxMention(body)) {
    await processTxMention(db, {
      orgId,
      bookmarkId: bookmark.id,
      commentId: comment.id,
      author,
      userId: reviewerUserId,
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
