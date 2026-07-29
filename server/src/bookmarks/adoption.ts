import type postgres from "postgres";

export async function findOrCreateBookmark(
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

export async function adoptLatestEventFromBranchSibling(
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
