import type postgres from "postgres";
import {
  findInstalledRepository,
  getInstallationAccessToken,
} from "../github/app";
import type { BookmarkRow } from "./bookmark";

export async function reconcilePublishBookmarkWithPullRequest(
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
