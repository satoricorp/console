import type postgres from "postgres";

export type GithubPostSkipSource =
  | "github_webhook"
  | "publish"
  | "summary_api"
  | "cli";

export type RecordGithubPostSkipInput = {
  orgId: string;
  bookmarkId?: string | null;
  eventId?: string | null;
  reason: string;
  source: GithubPostSkipSource;
  prNumber?: number | null;
  repoFullName?: string | null;
};

/** Persist that a GitHub PR post was triggered but intentionally not sent. */
export async function recordGithubPostSkip(
  db: postgres.Sql,
  input: RecordGithubPostSkipInput,
): Promise<void> {
  const now = Date.now();
  await db`
    INSERT INTO github_post_skips (
      org_id,
      bookmark_id,
      event_id,
      reason,
      source,
      pr_number,
      repo_full_name,
      created_at_ms
    ) VALUES (
      ${input.orgId},
      ${input.bookmarkId ?? null},
      ${input.eventId ?? null},
      ${input.reason},
      ${input.source},
      ${input.prNumber ?? null},
      ${input.repoFullName ?? null},
      ${now}
    )
  `;
}
