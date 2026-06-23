import { Hono } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import { containsGxMention, handleGxMention } from "../gx-mention/handler";
import { enqueueIndexJob } from "../indexing/jobs";
import { checkPrSummaryQuota, upgradeMessage } from "../metering/quota";
import { detectOutcomeStub } from "../outcomes/stub";
import { classifyReviewComment, type ClassifyInput } from "../rules/classifier";
import { generateSummary } from "../summary/generate";
import { createMockProvider } from "../llm/provider";
import { capture, Events } from "../telemetry/posthog";
import {
  getInstallationAccessToken,
  resolveOrgIdForInstallation,
  verifyGitHubWebhookSignature,
} from "./app";
import { postIssueComment, postPullRequestReviewReply } from "./comments";

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
  login?: string;
};

type GitHubPullRequest = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
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
  const reposAdded = payload.repositories_added ?? [];
  await db.begin(async (tx) => {
    await upsertInstallation(tx, installation, now);
    await upsertOrgForInstallation(tx, installation.installationId, now);

    for (const repo of reposAdded) {
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

  const orgId = await resolveOrgIdForInstallation(db, installation.installationId);
  if (!orgId) return;

  for (const repo of reposAdded) {
    if (!repo.full_name) continue;
    enqueueIndexJob({
      orgId,
      repoFullName: repo.full_name,
      reason: "install",
      ref: repo.default_branch ? `refs/heads/${repo.default_branch}` : undefined,
    });
  }
}

async function handlePullRequest(db: postgres.Sql, payload: WebhookPayload) {
  const action = payload.action ?? "";
  if (action !== "opened" && action !== "synchronize") {
    return;
  }

  const installationId = payload.installation?.id;
  const repo = payload.repository;
  const pr = payload.pull_request;
  if (typeof installationId !== "number" || !repo?.full_name || typeof pr?.number !== "number") {
    return;
  }

  const orgId = await ensureOrgIdForPayload(db, payload);
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

  const quota = await checkPrSummaryQuota(db, orgId, bookmark.id);
  if (!quota.allowed) {
    console.info("PR Summary blocked by quota", { orgId, bookmarkId: bookmark.id });
    capture(
      Events.SummaryQuotaBlocked,
      {
        bookmark_id: bookmark.id,
        pr_number: pr.number,
        repo: repo.full_name,
        used: quota.used,
        limit: quota.limit,
        source: "github_webhook",
      },
      orgId,
    );
    try {
      const token = await getInstallationAccessToken(installationId);
      await postIssueComment(
        token,
        repo.full_name,
        pr.number,
        upgradeMessage(quota),
      );
    } catch (error) {
      console.error("Failed to post quota upgrade comment", { orgId, error });
    }
    return;
  }

  let result;
  try {
    result = await generateSummary(db, {
      orgId,
      userId: "github-webhook",
      bookmarkId: bookmark.id,
      provider: createMockProvider(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("no matching review event")) {
      console.info("PR Summary skipped: bookmark has no matching review event", {
        bookmarkId: bookmark.id,
        headSha: pr.head?.sha ?? null,
      });
      return;
    }
    throw error;
  }

  let githubCommentId: number | null = null;
  try {
    const token = await getInstallationAccessToken(installationId);
    const posted = await postIssueComment(
      token,
      repo.full_name,
      pr.number,
      result.content,
    );
    githubCommentId = posted.id;
  } catch (error) {
    console.error("Failed to post PR Summary comment", {
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
      github_comment_id: githubCommentId,
      posted: githubCommentId !== null,
    },
    orgId,
  );

  const now = Date.now();
  await db`
    INSERT INTO pr_comments (
      org_id, bookmark_id, github_comment_id, author, body, is_gx_mention, created_at_ms
    ) VALUES (
      ${orgId},
      ${bookmark.id},
      ${githubCommentId},
      'gx',
      ${result.content},
      false,
      ${now}
    )
  `;
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

  const orgId = await ensureOrgIdForPayload(db, payload);
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

  const orgId = await ensureOrgIdForPayload(db, payload);
  await ingestLineComment(db, {
    orgId: orgId ?? undefined,
    installationId,
    repoFullName: repo.full_name,
    pullNumber: pr.number,
    branchName: pr.head?.ref ?? `pr-${pr.number}`,
    prUrl: pr.html_url ?? null,
    headSha: pr.head?.sha ?? null,
    comment,
    reviewState: null as ClassifyInput["reviewState"],
  });
}

async function handleIssueComment(db: postgres.Sql, payload: WebhookPayload) {
  if (!payload.issue?.pull_request) {
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

  const orgId = await ensureOrgIdForPayload(db, payload);
  await ingestLineComment(db, {
    orgId: orgId ?? undefined,
    installationId,
    repoFullName: repo.full_name,
    pullNumber: issueNumber,
    branchName: pr?.head?.ref ?? `pr-${issueNumber}`,
    prUrl: pr?.html_url ?? null,
    headSha: pr?.head?.sha ?? null,
    comment,
    reviewState: null as ClassifyInput["reviewState"],
  });
}

async function handlePush(db: postgres.Sql, payload: WebhookPayload) {
  const repo = payload.repository;
  const installationId = payload.installation?.id;
  if (!repo?.full_name || typeof installationId !== "number") {
    return;
  }

  const orgId = await ensureOrgIdForPayload(db, payload);
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
    orgId?: string;
    installationId: number;
    repoFullName: string;
    pullNumber: number;
    branchName: string;
    prUrl: string | null;
    headSha: string | null;
    comment: GitHubComment;
    reviewState: ClassifyInput["reviewState"];
  },
) {
  const orgId =
    input.orgId ?? (await resolveOrgIdForInstallation(db, input.installationId));
  if (!orgId) return;

  const bookmark = await findOrCreateBookmark(db, {
    orgId,
    repoFullName: input.repoFullName,
    branchName: input.branchName,
    prNumber: input.pullNumber,
    prUrl: input.prUrl,
    headSha: input.headSha,
  });

  const body = input.comment.body?.trim() ?? "";
  const author = input.comment.user?.login ?? "unknown";
  const isGx = containsGxMention(body);
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
    const [updated] = await db<{ id: string; latest_event_id: string | null }[]>`
      UPDATE bookmarks
      SET
        branch_name = ${input.branchName},
        github_pr_url = COALESCE(${input.prUrl}, github_pr_url),
        remote_head_sha = COALESCE(${input.headSha}, remote_head_sha),
        head_commit_id = COALESCE(${input.headSha}, head_commit_id),
        updated_at_ms = ${Date.now()}
      WHERE id = ${existing.id}
        AND org_id = ${input.orgId}
      RETURNING id, latest_event_id
    `;
    return updated ?? existing;
  }

  const now = Date.now();
  const [created] = await db<{ id: string; latest_event_id: string | null }[]>`
    INSERT INTO bookmarks (
      user_id,
      repo_full_name,
      branch_name,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      head_commit_id,
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
      ${input.headSha},
      ${now},
      ${now},
      ${input.orgId}
    )
    RETURNING id, latest_event_id
  `;
  return created;
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

async function ensureOrgIdForPayload(
  db: postgres.Sql,
  payload: WebhookPayload,
): Promise<string | null> {
  const installation = normalizeInstallation(payload.installation);
  if (!installation) return null;

  const repo = payload.repository
    ? normalizeRepository(payload.repository, installation.installationId)
    : null;
  const now = Date.now();

  await db.begin(async (tx) => {
    await upsertInstallation(tx, installation, now);
    await upsertOrgForInstallation(tx, installation.installationId, now);
    if (repo) {
      await upsertRepository(tx, repo, now);
    }
  });

  return resolveOrgIdForInstallation(db, installation.installationId);
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
      account_id = COALESCE(EXCLUDED.account_id, github_app_installations.account_id),
      account_login = COALESCE(NULLIF(EXCLUDED.account_login, ''), github_app_installations.account_login),
      account_type = COALESCE(NULLIF(EXCLUDED.account_type, ''), github_app_installations.account_type),
      repository_selection = COALESCE(NULLIF(EXCLUDED.repository_selection, ''), github_app_installations.repository_selection),
      app_id = COALESCE(EXCLUDED.app_id, github_app_installations.app_id),
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
