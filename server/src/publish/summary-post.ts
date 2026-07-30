import type postgres from "postgres";
import {
  findInstalledRepository,
  getInstallationAccessToken,
} from "../github/app";
import { updatePullRequestWithSummary, withUnindexedNotice } from "../github/pr-body";
import { QuotaExceededError } from "../metering/quota";
import { enrichSummaryLinks } from "../summary/enrich-links";
import { enrichSeverityDots } from "../summary/severity";
import {
  generateSummary,
  loadExtractContext,
  resolveSummaryTarget,
  summaryLinkContextFromExtract,
} from "../summary/generate";
import { capture, Events } from "../telemetry/posthog";
import type { BookmarkRow } from "./bookmark";

export async function postMissingPrSummaryAfterPublish(
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
      AND author = 'tx'
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
        // Stored summaries do not record whether retrieval saw the repository,
        // so a re-post cannot honestly add or drop the notice; only freshly
        // generated summaries carry the flag.
        sawIndexedCode: true,
      }
    : await generateMissingSummary(db, {
        orgId: input.orgId,
        userId: input.userId,
        bookmarkId: input.bookmark.id,
        githubPrUrl: input.bookmark.github_pr_url,
      });
  if (!summary) return;

  let bodyUpdated = false;
  let postedBody = withUnindexedNotice(summary.content, summary.sawIndexedCode);
  try {
    const result = await updatePullRequestWithSummary(
      token,
      input.bookmark.repo_full_name,
      input.bookmark.github_pr_number,
      postedBody,
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
      org_id, bookmark_id, github_comment_id, author, body, is_tx_mention, created_at_ms
    ) VALUES (
      ${input.orgId},
      ${input.bookmark.id},
      ${null},
      'tx',
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
): Promise<
  { summaryId: string; eventId: string; content: string; sawIndexedCode: boolean } | null
> {
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
      sawIndexedCode: result.sawIndexedCode,
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
    return enrichSeverityDots(
      enrichSummaryLinks(
        input.content,
        summaryLinkContextFromExtract(ctx, input.githubPrUrl),
      ),
    );
  } catch {
    return enrichSeverityDots(
      enrichSummaryLinks(input.content, {
        prUrl: input.githubPrUrl,
        headSha: null,
        hunks: [],
      }),
    );
  }
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
