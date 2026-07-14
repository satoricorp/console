import { Hono, type Context } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import {
  findInstalledRepository,
  getInstallationAccessToken,
  resolveOrgIdForInstallation,
} from "../github/app";
import { updatePullRequestWithSummary } from "../github/pr-body";
import { indexPublishedArtifact } from "../indexing/turbopuffer";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { enqueueReviewPlanGeneration } from "../review-plan/generate";
import { QuotaExceededError } from "../metering/quota";
import { enrichSummaryLinks } from "../summary/enrich-links";
import {
  generateSummary,
  loadExtractContext,
  resolveSummaryTarget,
  summaryLinkContextFromExtract,
} from "../summary/generate";
import { capture, Events } from "../telemetry/posthog";
import type { PublishRegistration, PushBundle } from "../types";

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

type BookmarkRow = {
  id: string;
  user_id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number;
  latest_event_id: string | null;
  head_commit_id: string | null;
  github_pr_url: string | null;
  github_pr_number: number | null;
  remote_head_sha: string | null;
  merge_status: "open" | "merged" | "closed";
  published_at_ms: string;
  updated_at_ms: string;
  storage_backend: string;
};

export const publishRoutes = new Hono<AppEnv>();

publishRoutes.use("/v1/publish", requireAuth);

publishRoutes.post("/v1/publish", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (isRecord(body) && body.event === "gx.pr") {
    return handleArtifactPublish(c, body);
  }
  return handlePublishRegistration(c, body);
});

async function handleArtifactPublish(c: Context<AppEnv>, body: unknown) {
  const auth = c.get("auth");
  let payload: PushBundle;
  try {
    payload = validatePublishPayload(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid publish payload";
    return c.json({ error: message }, 400);
  }

  const now = Date.now();
  const repoFullName = repoFullNameFromPayload(payload, auth.githubUserLogin);
  const branchName = inferPublishBranchName(payload);
  const githubPrUrl = payload.push.github_pull_request_url ?? null;
  const githubPrNumber = parseGithubPrNumber(githubPrUrl);
  const title = inferBookmarkTitle(payload, branchName);

  try {
    const db = getSql();
    const orgId = await resolvePublishOrgId(db, auth.orgId, repoFullName);
    const result = await db.begin(async (tx) => {
      const [event] = await tx<{ id: string }[]>`
        INSERT INTO pr_events (
          event,
          created_at_ms,
          gx_version,
          user_id,
          session_id,
          machine_id,
          github_user_id,
          github_user_login,
          repo_root_path,
          repo_backend,
          remote_url,
          branch_name,
          head_commit_id,
          github_pr_url,
          payload,
          org_id
        ) VALUES (
          ${payload.event},
          ${payload.created_at || now},
          ${payload.gx_version},
          ${auth.userId},
          ${auth.sessionId ?? null},
          ${auth.machineId ?? null},
          ${auth.githubUserId ?? null},
          ${auth.githubUserLogin ?? null},
          ${payload.repo.root_path},
          ${payload.repo.backend},
          ${payload.repo.remote_url ?? null},
          ${branchName},
          ${payload.push.head_commit_id},
          ${githubPrUrl},
          ${tx.json(payload as postgres.JSONValue)},
          ${orgId}
        )
        RETURNING id
      `;
      if (!event?.id) {
        throw new Error("Failed to insert publish event");
      }

      const bookmark = await upsertBookmark(tx, {
        orgId,
        userId: auth.userId,
        requestedId: validUuid(payload.pr_id) ? payload.pr_id! : null,
        repoFullName,
        branchName,
        title,
        eventId: event.id,
        headCommitId: payload.push.head_commit_id,
        githubPrUrl,
        githubPrNumber,
        remoteHeadSha: null,
        updatedAtMs: payload.created_at || now,
      });

      return { eventId: event.id, bookmark };
    });

    const indexResult = await indexPublishedArtifact({
      orgId,
      repoFullName: result.bookmark.repo_full_name,
      eventId: result.eventId,
      branchName: result.bookmark.branch_name,
      headSha: payload.push.head_commit_id,
      payload,
    });
    if (indexResult.status === "failed") {
      console.info("GX artifact indexing failed", {
        orgId: auth.orgId,
        repoFullName: result.bookmark.repo_full_name,
        eventId: result.eventId,
        error: indexResult.error,
      });
    }

    // Plain `git push` + `gh pr create` publishes without a PR URL. Attach the
    // open PR (and steal PR ownership from any webhook-only bookmark) so
    // /reviews and PR summary both use the publisher's event-bearing row.
    const bookmark = await reconcilePublishBookmarkWithPullRequest(db, {
      orgId,
      bookmark: result.bookmark,
      githubPrUrl,
      githubPrNumber,
    });

    await refreshBookmarkAppFields(db, bookmark.id, payload);

    try {
      await postMissingPrSummaryAfterPublish(db, {
        orgId,
        userId: auth.userId,
        bookmark,
      });
    } catch (error) {
      console.error("PR Summary after publish failed", {
        orgId,
        bookmarkId: bookmark.id,
        error,
      });
    }

    try {
      if (bookmark.head_commit_id) {
        enqueueReviewPlanGeneration(db, {
          orgId,
          bookmarkId: bookmark.id,
          headCommitId: bookmark.head_commit_id,
          eventId: result.eventId,
        });
      }
    } catch (error) {
      console.error("Review plan enqueue after publish failed", {
        orgId,
        bookmarkId: bookmark.id,
        error,
      });
    }

    capturePublishArtifact(payload, bookmark, {
      orgId,
      eventId: result.eventId,
      indexStatus: indexResult.status,
    });

    const url = reviewUrl(bookmark.id);
    return c.json(
      {
        id: bookmark.id,
        event_id: result.eventId,
        review_id: bookmark.id,
        ...(url ? { url, review_url: url } : {}),
        index_status: indexResult.status,
        repo_full_name: bookmark.repo_full_name,
        branch_name: bookmark.branch_name,
        title: bookmark.title,
        revision: bookmark.revision,
        github_pr_url: bookmark.github_pr_url,
        github_pr_number: bookmark.github_pr_number,
        head_commit_id: bookmark.head_commit_id,
        remote_head_sha: bookmark.remote_head_sha,
      },
      201,
    );
  } catch (error) {
    console.error("Failed to publish GX payload", error);
    return c.json({ error: "Failed to publish" }, 500);
  }
}

async function reconcilePublishBookmarkWithPullRequest(
  db: postgres.Sql,
  input: {
    orgId: string;
    bookmark: BookmarkRow;
    githubPrUrl: string | null;
    githubPrNumber: number | null;
  },
): Promise<BookmarkRow> {
  let prNumber = input.githubPrNumber;
  let prUrl = input.githubPrUrl;
  const lookedUp = await lookupOpenPullRequestForBranch(
    db,
    input.bookmark.repo_full_name,
    input.bookmark.branch_name,
  );
  if (lookedUp) {
    prNumber = lookedUp.number;
    prUrl = lookedUp.htmlUrl;
  }

  if (prNumber === null) {
    return input.bookmark;
  }
  if (
    input.bookmark.github_pr_number === prNumber &&
    (!lookedUp || input.bookmark.merge_status === "open")
  ) {
    return input.bookmark;
  }

  // org+repo+pr is unique. If a webhook-only bookmark already owns the PR
  // number, clear it so the publisher's event-bearing bookmark can take it.
  const [existingPrBookmark] = await db<{ id: string; user_id: string }[]>`
    SELECT id, user_id
    FROM bookmarks
    WHERE org_id = ${input.orgId}
      AND repo_full_name = ${input.bookmark.repo_full_name}
      AND github_pr_number = ${prNumber}
      AND id <> ${input.bookmark.id}
    LIMIT 1
  `;
  if (existingPrBookmark) {
    await db`
      UPDATE bookmarks
      SET github_pr_number = NULL,
          github_pr_url = NULL,
          updated_at_ms = ${Date.now()}
      WHERE id = ${existingPrBookmark.id}
    `;
    if (existingPrBookmark.user_id === "github-webhook") {
      await db`
        DELETE FROM bookmarks
        WHERE id = ${existingPrBookmark.id}
          AND user_id = 'github-webhook'
          AND latest_event_id IS NULL
      `;
    }
  }

  const [updated] = await db<BookmarkRow[]>`
    UPDATE bookmarks
    SET github_pr_number = ${prNumber},
        github_pr_url = COALESCE(${prUrl}, bookmarks.github_pr_url),
        merge_status = CASE
          WHEN ${lookedUp !== null} THEN 'open'
          ELSE bookmarks.merge_status
        END,
        merged_at_ms = CASE
          WHEN ${lookedUp !== null} THEN NULL
          ELSE bookmarks.merged_at_ms
        END,
        updated_at_ms = ${Date.now()}
    WHERE id = ${input.bookmark.id}
    RETURNING *
  `;
  return updated ?? input.bookmark;
}

async function lookupOpenPullRequestForBranch(
  db: postgres.Sql,
  repoFullName: string,
  branchName: string,
): Promise<{ number: number; htmlUrl: string } | null> {
  const branch = branchName.trim();
  if (!branch || branch === "HEAD" || branch === "unknown") {
    return null;
  }
  const grant = await findInstalledRepository(db, repoFullName);
  if (!grant) {
    return null;
  }

  const owner = repoFullName.split("/")[0]?.trim();
  if (!owner) {
    return null;
  }

  let token: string;
  try {
    token = await getInstallationAccessToken(grant.installationId);
  } catch (error) {
    console.error("PR lookup after publish skipped: installation token failed", {
      repoFullName,
      branchName: branch,
      error,
    });
    return null;
  }

  const head = `${owner}:${branch}`;
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gx-server",
      },
    },
  );
  if (!response.ok) {
    console.error("PR lookup after publish failed", {
      repoFullName,
      branchName: branch,
      status: response.status,
      body: (await response.text()).slice(0, 300),
    });
    return null;
  }

  const payload = (await response.json()) as Array<{
    number?: number;
    html_url?: string;
  }>;
  const first = payload[0];
  if (typeof first?.number !== "number" || !first.html_url) {
    return null;
  }
  return { number: first.number, htmlUrl: first.html_url };
}

async function postMissingPrSummaryAfterPublish(
  db: postgres.Sql,
  input: {
    orgId: string;
    userId: string;
    bookmark: BookmarkRow;
  },
) {
  if (!input.bookmark.github_pr_number) {
    return;
  }

  const [existingPostedSummary] = await db<{ id: string }[]>`
    SELECT id
    FROM pr_comments
    WHERE org_id = ${input.orgId}
      AND bookmark_id = ${input.bookmark.id}
      AND author = 'gx'
    LIMIT 1
  `;
  if (existingPostedSummary) {
    return;
  }

  const [existingSummary] = await db<{ id: string; content: string }[]>`
    SELECT id
         , content
    FROM summaries
    WHERE org_id = ${input.orgId}
      AND bookmark_id = ${input.bookmark.id}
    ORDER BY posted_at_ms DESC
    LIMIT 1
  `;

  const grant = await findInstalledRepository(db, input.bookmark.repo_full_name);
  if (!grant) {
    console.info("PR Summary after publish skipped: repo is not installed", {
      orgId: input.orgId,
      bookmarkId: input.bookmark.id,
      repoFullName: input.bookmark.repo_full_name,
    });
    return;
  }

  let token: string;
  try {
    token = await getInstallationAccessToken(grant.installationId);
  } catch (error) {
    console.error("PR Summary after publish skipped: failed to get installation token", {
      orgId: input.orgId,
      bookmarkId: input.bookmark.id,
      error,
    });
    return;
  }

  const summary = existingSummary
    ? {
        summaryId: existingSummary.id,
        eventId: input.bookmark.latest_event_id,
        content: await enrichExistingSummary(db, {
          orgId: input.orgId,
          bookmarkId: input.bookmark.id,
          content: existingSummary.content,
          githubPrUrl: input.bookmark.github_pr_url,
        }),
      }
    : await generateMissingSummary(db, {
        orgId: input.orgId,
        userId: input.userId,
        bookmarkId: input.bookmark.id,
        githubPrUrl: input.bookmark.github_pr_url,
      });
  if (!summary) return;

  let bodyUpdated = false;
  let postedBody = summary.content;
  try {
    const result = await updatePullRequestWithSummary(
      token,
      input.bookmark.repo_full_name,
      input.bookmark.github_pr_number,
      summary.content,
    );
    bodyUpdated = result.updated;
    postedBody = result.body;
  } catch (error) {
    console.error("Failed to update PR Summary body after publish", {
      orgId: input.orgId,
      bookmarkId: input.bookmark.id,
      error,
    });
    return;
  }

  capture(
    Events.SummaryPosted,
    {
      bookmark_id: input.bookmark.id,
      event_id: summary.eventId,
      summary_id: summary.summaryId,
      pr_number: input.bookmark.github_pr_number,
      repo: input.bookmark.repo_full_name,
      github_comment_id: null,
      posted: true,
      body_updated: bodyUpdated,
      target: "pr_body",
      source: "publish",
    },
    input.orgId,
  );
  captureGitHubCommentPosted(
    {
      bookmarkId: input.bookmark.id,
      eventId: summary.eventId,
      summaryId: summary.summaryId,
      prNumber: input.bookmark.github_pr_number,
      repo: input.bookmark.repo_full_name,
      githubCommentId: null,
      commentKind: "pr_summary_body",
      source: "publish",
    },
    input.orgId,
  );

  await db`
    INSERT INTO pr_comments (
      org_id, bookmark_id, github_comment_id, author, body, is_gx_mention, created_at_ms
    ) VALUES (
      ${input.orgId},
      ${input.bookmark.id},
      ${null},
      'gx',
      ${postedBody},
      false,
      ${Date.now()}
    )
  `;
}

async function generateMissingSummary(
  db: postgres.Sql,
  input: {
    orgId: string;
    userId: string;
    bookmarkId: string;
    githubPrUrl?: string | null;
  },
): Promise<{ summaryId: string; eventId: string; content: string } | null> {
  try {
    const result = await generateSummary(db, {
      orgId: input.orgId,
      userId: input.userId,
      bookmarkId: input.bookmarkId,
      quotaSkipSource: "publish",
      githubPrUrl: input.githubPrUrl,
    });
    return {
      summaryId: result.summaryId,
      eventId: result.eventId,
      content: result.content,
    };
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      console.info("PR Summary after publish skipped: not posting to GitHub", {
        orgId: input.orgId,
        bookmarkId: input.bookmarkId,
        reason: error.message,
      });
      return null;
    }
    console.error("PR Summary after publish failed", {
      orgId: input.orgId,
      bookmarkId: input.bookmarkId,
      error,
    });
    return null;
  }
}

async function enrichExistingSummary(
  db: postgres.Sql,
  input: {
    orgId: string;
    bookmarkId: string;
    content: string;
    githubPrUrl: string | null;
  },
): Promise<string> {
  try {
    const target = await resolveSummaryTarget(db, input.orgId, {
      bookmarkId: input.bookmarkId,
    });
    const ctx = await loadExtractContext(db, input.orgId, target);
    return enrichSummaryLinks(
      input.content,
      summaryLinkContextFromExtract(ctx, input.githubPrUrl),
    );
  } catch {
    return enrichSummaryLinks(input.content, {
      prUrl: input.githubPrUrl,
      headSha: null,
      hunks: [],
    });
  }
}

async function handlePublishRegistration(c: Context<AppEnv>, body: unknown) {
  const auth = c.get("auth");
  let registration: PublishRegistration;
  try {
    registration = validatePublishRegistration(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid publish registration";
    return c.json({ error: message }, 400);
  }

  try {
    const db = getSql();
    const orgId = await resolvePublishOrgId(db, auth.orgId, registration.repo_full_name);
    const bookmark = await upsertBookmark(db, {
      orgId,
      userId: auth.userId,
      requestedId: null,
      repoFullName: registration.repo_full_name,
      branchName: registration.branch_name,
      title: registration.title || branchSlugTitle(registration.branch_name),
      eventId: null,
      headCommitId: registration.head_commit_id,
      githubPrUrl: registration.github_pr_url ?? null,
      githubPrNumber: parseGithubPrNumber(registration.github_pr_url ?? null),
      remoteHeadSha: registration.remote_head_sha ?? null,
      updatedAtMs: Date.now(),
    });

    capturePublishRegistration(registration, bookmark, orgId);

    return c.json(
      {
        id: bookmark.id,
        repo_full_name: bookmark.repo_full_name,
        branch_name: bookmark.branch_name,
        github_pr_url: bookmark.github_pr_url,
        github_pr_number: bookmark.github_pr_number,
        head_commit_id: bookmark.head_commit_id,
        remote_head_sha: bookmark.remote_head_sha,
      },
      201,
    );
  } catch (error) {
    console.error("Failed to register GX publish", error);
    return c.json({ error: "Failed to register publish" }, 500);
  }
}

function validatePublishPayload(value: unknown): PushBundle {
  if (!isRecord(value)) throw new Error("Body must be a JSON object");
  if (value.event !== "gx.pr") throw new Error("Unsupported event");
  if (typeof value.created_at !== "number" || !Number.isFinite(value.created_at)) {
    throw new Error("created_at is required");
  }
  if (typeof value.gx_version !== "string" || !value.gx_version.trim()) {
    throw new Error("gx_version is required");
  }
  if (!isRecord(value.repo)) throw new Error("repo is required");
  if (typeof value.repo.root_path !== "string" || !value.repo.root_path.trim()) {
    throw new Error("repo.root_path is required");
  }
  if (typeof value.repo.backend !== "string" || !value.repo.backend.trim()) {
    throw new Error("repo.backend is required");
  }
  if (!isRecord(value.push)) throw new Error("push is required");
  if (typeof value.push.head_commit_id !== "string" || !value.push.head_commit_id.trim()) {
    throw new Error("push.head_commit_id is required");
  }
  return value as PushBundle;
}

function validatePublishRegistration(value: unknown): PublishRegistration {
  if (!isRecord(value)) throw new Error("Body must be a JSON object");
  const repoFullName = stringValue(value.repo_full_name);
  const branchName = stringValue(value.branch_name);
  const headCommitId = stringValue(value.head_commit_id);
  if (!repoFullName) throw new Error("repo_full_name is required");
  if (!branchName) throw new Error("branch_name is required");
  if (!headCommitId) throw new Error("head_commit_id is required");
  return {
    repo_full_name: repoFullName,
    branch_name: branchName,
    title: stringValue(value.title) || undefined,
    head_commit_id: headCommitId,
    remote_head_sha: stringValue(value.remote_head_sha) || undefined,
    github_pr_url: stringValue(value.github_pr_url) || undefined,
  };
}

async function resolvePublishOrgId(
  db: SqlExecutor,
  fallbackOrgId: string,
  repoFullName: string,
): Promise<string> {
  const grant = await findInstalledRepository(db, repoFullName);
  if (!grant) {
    return fallbackOrgId;
  }
  return (await resolveOrgIdForInstallation(db, grant.installationId)) ?? fallbackOrgId;
}

async function upsertBookmark(
  tx: SqlExecutor,
  args: {
    orgId: string;
    userId: string;
    requestedId: string | null;
    repoFullName: string;
    branchName: string;
    title: string;
    eventId: string | null;
    headCommitId: string;
    githubPrUrl: string | null;
    githubPrNumber: number | null;
    remoteHeadSha: string | null;
    updatedAtMs: number;
  },
): Promise<BookmarkRow> {
  if (!args.requestedId && args.githubPrNumber !== null) {
    const [existingPrBookmark] = await tx<BookmarkRow[]>`
      UPDATE bookmarks
      SET
        org_id = ${args.orgId},
        branch_name = ${args.branchName},
        title = COALESCE(bookmarks.title, ${args.title}),
        revision = bookmarks.revision + 1,
        latest_event_id = COALESCE(${args.eventId}, bookmarks.latest_event_id),
        head_commit_id = ${args.headCommitId},
        github_pr_url = COALESCE(${args.githubPrUrl}, bookmarks.github_pr_url),
        remote_head_sha = COALESCE(${args.remoteHeadSha}, bookmarks.remote_head_sha),
        updated_at_ms = ${args.updatedAtMs}
      WHERE user_id = ${args.userId}
        AND repo_full_name = ${args.repoFullName}
        AND github_pr_number = ${args.githubPrNumber}
      RETURNING *
    `;
    if (existingPrBookmark) {
      return existingPrBookmark;
    }
  }

  if (args.requestedId) {
    const [row] = await tx<BookmarkRow[]>`
      INSERT INTO bookmarks (
        id,
        org_id,
        user_id,
        repo_full_name,
        branch_name,
        title,
        latest_event_id,
        head_commit_id,
        github_pr_url,
        github_pr_number,
        remote_head_sha,
        updated_at_ms,
        published_at_ms
      ) VALUES (
        ${args.requestedId},
        ${args.orgId},
        ${args.userId},
        ${args.repoFullName},
        ${args.branchName},
        ${args.title},
        ${args.eventId},
        ${args.headCommitId},
        ${args.githubPrUrl},
        ${args.githubPrNumber},
        ${args.remoteHeadSha},
        ${args.updatedAtMs},
        ${args.updatedAtMs}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        org_id = EXCLUDED.org_id,
        user_id = EXCLUDED.user_id,
        repo_full_name = EXCLUDED.repo_full_name,
        branch_name = EXCLUDED.branch_name,
        revision = bookmarks.revision + 1,
        latest_event_id = COALESCE(EXCLUDED.latest_event_id, bookmarks.latest_event_id),
        head_commit_id = EXCLUDED.head_commit_id,
        github_pr_url = COALESCE(EXCLUDED.github_pr_url, bookmarks.github_pr_url),
        github_pr_number = COALESCE(EXCLUDED.github_pr_number, bookmarks.github_pr_number),
        remote_head_sha = COALESCE(EXCLUDED.remote_head_sha, bookmarks.remote_head_sha),
        title = COALESCE(bookmarks.title, EXCLUDED.title),
        updated_at_ms = EXCLUDED.updated_at_ms
      RETURNING *
    `;
    if (!row) throw new Error("Failed to upsert bookmark");
    return row;
  }

  const [row] = await tx<BookmarkRow[]>`
    INSERT INTO bookmarks (
      org_id,
      user_id,
      repo_full_name,
      branch_name,
      title,
      latest_event_id,
      head_commit_id,
      github_pr_url,
      github_pr_number,
      remote_head_sha,
      updated_at_ms,
      published_at_ms
    ) VALUES (
      ${args.orgId},
      ${args.userId},
      ${args.repoFullName},
      ${args.branchName},
      ${args.title},
      ${args.eventId},
      ${args.headCommitId},
      ${args.githubPrUrl},
      ${args.githubPrNumber},
      ${args.remoteHeadSha},
      ${args.updatedAtMs},
      ${args.updatedAtMs}
    )
    ON CONFLICT (user_id, repo_full_name, branch_name)
    DO UPDATE SET
      org_id = EXCLUDED.org_id,
      revision = bookmarks.revision + 1,
      latest_event_id = COALESCE(EXCLUDED.latest_event_id, bookmarks.latest_event_id),
      head_commit_id = EXCLUDED.head_commit_id,
      github_pr_url = COALESCE(EXCLUDED.github_pr_url, bookmarks.github_pr_url),
      github_pr_number = COALESCE(EXCLUDED.github_pr_number, bookmarks.github_pr_number),
      remote_head_sha = COALESCE(EXCLUDED.remote_head_sha, bookmarks.remote_head_sha),
      title = COALESCE(bookmarks.title, EXCLUDED.title),
      updated_at_ms = EXCLUDED.updated_at_ms
    RETURNING *
  `;
  if (!row) throw new Error("Failed to upsert bookmark");
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function repoFullNameFromPayload(payload: PushBundle, githubLogin?: string): string {
  const candidates = [
    payload.push.github_pull_request_url,
    payload.repo.remote_url,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const match = /github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#]|$)/i.exec(candidate);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }
  const repoName = payload.repo.root_path.split("/").filter(Boolean).at(-1) ?? "repo";
  return `${githubLogin || "unknown"}/${repoName}`;
}

function inferPublishBranchName(payload: PushBundle): string {
  const defaultBranch = payload.repo.default_branch?.trim() || "main";
  const pushBranch = payload.push.branch_name?.trim();
  const repoBranch = payload.repo.branch_name?.trim();

  for (const entry of payload.stack ?? []) {
    const stackBranch = entry.branch_name?.trim();
    if (stackBranch && stackBranch !== defaultBranch) {
      return stackBranch;
    }
  }

  if (pushBranch && pushBranch !== defaultBranch) {
    return pushBranch;
  }
  if (repoBranch && repoBranch !== defaultBranch) {
    return repoBranch;
  }
  return pushBranch || repoBranch || "unknown";
}

function inferBookmarkTitle(payload: PushBundle, branchName: string): string {
  for (const entry of payload.stack ?? []) {
    const title = entry.change?.description?.split("\n")[0]?.trim();
    if (title) return title;
  }
  const title = payload.change?.description?.split("\n")[0]?.trim();
  if (title) return title;
  return branchSlugTitle(branchName);
}

function capturePublishArtifact(
  payload: PushBundle,
  bookmark: BookmarkRow,
  input: { orgId: string; eventId: string; indexStatus: string },
) {
  capture(
    Events.PublishArtifact,
    {
      bookmark_id: bookmark.id,
      event_id: input.eventId,
      repo: bookmark.repo_full_name,
      revision_count: publishRevisionCount(payload),
      stack_count: 1,
      session_count: payload.sessions?.length ?? 0,
      has_github_pr: bookmark.github_pr_number !== null,
      github_pr_number: bookmark.github_pr_number,
      index_status: input.indexStatus,
      gx_version: payload.gx_version,
      source: "artifact",
    },
    input.orgId,
  );
}

function capturePublishRegistration(
  registration: PublishRegistration,
  bookmark: BookmarkRow,
  orgId: string,
) {
  capture(
    Events.PublishRegistration,
    {
      bookmark_id: bookmark.id,
      repo: bookmark.repo_full_name,
      stack_count: 1,
      has_github_pr: bookmark.github_pr_number !== null,
      github_pr_number: bookmark.github_pr_number,
      has_remote_head_sha: Boolean(registration.remote_head_sha),
      source: "registration",
    },
    orgId,
  );
}

function publishRevisionCount(payload: PushBundle): number {
  if (payload.stack?.length) {
    return payload.stack.length;
  }
  return payload.change ? 1 : 0;
}

function captureGitHubCommentPosted(
  input: {
    bookmarkId: string;
    eventId?: string | null;
    summaryId?: string | null;
    prNumber: number | null;
    repo: string;
    githubCommentId: number | null;
    commentKind: string;
    source: string;
  },
  orgId: string,
) {
  capture(
    Events.GitHubCommentPosted,
    {
      bookmark_id: input.bookmarkId,
      event_id: input.eventId ?? null,
      summary_id: input.summaryId ?? null,
      pr_number: input.prNumber,
      repo: input.repo,
      github_comment_id: input.githubCommentId,
      comment_kind: input.commentKind,
      source: input.source,
    },
    orgId,
  );
}

function collectPublishFiles(payload: PushBundle): string[] {
  const files = new Set<string>();
  for (const file of payload.change?.files ?? []) {
    const trimmed = file.trim();
    if (trimmed) files.add(trimmed);
  }
  for (const entry of payload.stack ?? []) {
    for (const file of entry.change?.files ?? []) {
      const trimmed = file.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  return [...files];
}

async function refreshBookmarkAppFields(
  db: postgres.Sql,
  bookmarkId: string,
  payload: PushBundle,
) {
  const files = collectPublishFiles(payload);
  const stackCount = Math.max(
    payload.stack?.length ?? 0,
    payload.change ? 1 : 0,
  );
  const baseBranch =
    payload.stack?.find((entry) => entry.base_branch_name?.trim())?.base_branch_name?.trim() ||
    payload.repo.default_branch?.trim() ||
    "main";

  await db`
    UPDATE bookmarks
    SET app_file_count = ${files.length},
        app_stack_count = ${stackCount},
        app_base_branch = ${baseBranch}
    WHERE id = ${bookmarkId}
  `;
}

function branchSlugTitle(branchName: string): string {
  const slug = branchName.split("/").at(-1) ?? branchName;
  return slug.replace(/[-_]+/g, " ").trim() || branchName;
}

function parseGithubPrNumber(githubPrUrl: string | null | undefined): number | null {
  if (!githubPrUrl) return null;
  const match = /\/pull\/(\d+)(?:\/|$)/.exec(githubPrUrl);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function reviewUrl(bookmarkId: string): string | undefined {
  const siteUrl = (process.env.GX_SITE_URL || process.env.CONSOLE_SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return siteUrl ? `${siteUrl}/reviews/${bookmarkId}` : undefined;
}

function validUuid(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
