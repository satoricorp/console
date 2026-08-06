import type postgres from "postgres";
import { patchIssueComment, postIssueComment } from "../github/comments";
import { capture, Events } from "../telemetry/posthog";
import { fetchExternalDossier, generateExternalSummary } from "../summary/external";
import { isPublicRepo, listOpenPulls } from "./github";

/**
 * One poll tick for the OSS "watch" rail. Convex's cron calls the server route
 * that invokes this with the operator's enabled watchlist. For each repo we look
 * at open PRs and, for any whose head SHA we haven't already summarized, generate
 * a sessionless summary and post it as the gx bot user — editing the existing
 * comment in place if the PR was updated since we last posted.
 *
 * Everything is best-effort and per-PR isolated: one repo or PR failing must not
 * abort the rest of the tick.
 */

export type WatchRepoInput = { fullName: string; campaign?: string };

export type WatchTickResult = {
  reposProcessed: number;
  posted: number;
  updated: number;
  skipped: number;
  errors: number;
};

/** Bound the work per tick so a busy repo can't run away with rate limit / cost. */
const MAX_PRS_PER_REPO = 10;

type WatchPostRow = {
  pr_number: number;
  head_sha: string;
  comment_id: string | null;
};

export function watchBotToken(): string {
  const token = process.env.GX_WATCH_GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GX_WATCH_GITHUB_TOKEN is not set");
  }
  return token;
}

export async function runWatchTick(
  db: postgres.Sql,
  input: { repos: WatchRepoInput[] },
): Promise<WatchTickResult> {
  const token = watchBotToken();
  const result: WatchTickResult = {
    reposProcessed: 0,
    posted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  for (const repo of input.repos) {
    try {
      // Safety: the free rail only ever comments on public repos. Guards against
      // an operator typo, or the bot happening to have access to a private repo.
      if (!(await isPublicRepo(token, repo.fullName))) {
        console.warn("watch: skipping non-public repo", { repo: repo.fullName });
        continue;
      }

      const pulls = await listOpenPulls(token, repo.fullName);
      result.reposProcessed += 1;

      for (const pull of pulls.slice(0, MAX_PRS_PER_REPO)) {
        try {
          const action = await processPull(db, {
            token,
            repoFullName: repo.fullName,
            campaign: repo.campaign ?? "oss-watch",
            prNumber: pull.number,
            headSha: pull.headSha,
          });
          result[action] += 1;
        } catch (error) {
          result.errors += 1;
          console.error("watch: PR failed", {
            repo: repo.fullName,
            pr: pull.number,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      result.errors += 1;
      console.error("watch: repo failed", {
        repo: repo.fullName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function processPull(
  db: postgres.Sql,
  input: {
    token: string;
    repoFullName: string;
    campaign: string;
    prNumber: number;
    headSha: string;
  },
): Promise<"posted" | "updated" | "skipped"> {
  const [existing] = await db<WatchPostRow[]>`
    SELECT pr_number, head_sha, comment_id
    FROM watch_posts
    WHERE repo_full_name = ${input.repoFullName} AND pr_number = ${input.prNumber}
    LIMIT 1
  `;

  // Already summarized this exact head — nothing to do.
  if (existing && existing.head_sha === input.headSha) {
    return "skipped";
  }

  const dossier = await fetchExternalDossier(input.token, input.repoFullName, input.prNumber);
  // The listing SHA can race ahead of the fetch; trust the dossier's head.
  const summary = await generateExternalSummary(dossier, input.campaign);
  const now = Date.now();

  // Update in place when we already have a comment for this PR.
  if (existing?.comment_id) {
    try {
      await patchIssueComment(
        input.token,
        input.repoFullName,
        Number(existing.comment_id),
        summary.content,
      );
      await db`
        UPDATE watch_posts
        SET head_sha = ${summary.headSha}, campaign = ${input.campaign}, updated_at_ms = ${now}
        WHERE repo_full_name = ${input.repoFullName} AND pr_number = ${input.prNumber}
      `;
      capture(Events.SummaryPosted, {
        repo: input.repoFullName,
        pr_number: input.prNumber,
        target: "watch_comment",
        posted: true,
        body_updated: true,
      });
      return "updated";
    } catch (error) {
      // Comment was deleted or is no longer editable — fall through to re-post.
      console.warn("watch: patch failed, re-posting", {
        repo: input.repoFullName,
        pr: input.prNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const posted = await postIssueComment(
    input.token,
    input.repoFullName,
    input.prNumber,
    summary.content,
  );

  await db`
    INSERT INTO watch_posts (
      repo_full_name, pr_number, head_sha, comment_id, campaign, posted_at_ms, updated_at_ms
    ) VALUES (
      ${input.repoFullName}, ${input.prNumber}, ${summary.headSha}, ${posted.id},
      ${input.campaign}, ${now}, ${now}
    )
    ON CONFLICT (repo_full_name, pr_number) DO UPDATE
    SET head_sha = ${summary.headSha}, comment_id = ${posted.id},
        campaign = ${input.campaign}, updated_at_ms = ${now}
  `;

  capture(Events.SummaryPosted, {
    repo: input.repoFullName,
    pr_number: input.prNumber,
    target: "watch_comment",
    posted: true,
    body_updated: false,
  });
  return existing ? "updated" : "posted";
}
