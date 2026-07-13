import type postgres from "postgres";
import {
  getInstallationAccessToken,
  findInstalledRepository,
} from "../github/app";
import { WEBHOOK_BOOKMARK_USER } from "./eligibility";

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export type VerifiedGithubPull = {
  number: number;
  htmlUrl: string;
  nodeId: string;
  repoId: number;
  state: string;
  merged: boolean;
  mergedAt: string | null;
  headSha: string | null;
  headRef: string | null;
};

type CanonicalBookmark = {
  id: string;
  org_id: string;
  user_id: string;
  repo_full_name: string;
  branch_name: string;
  latest_event_id: string | null;
  head_commit_id: string | null;
  github_pr_number: number | null;
  github_pr_url: string | null;
  github_repo_id: number | null;
  github_pr_node_id: string | null;
  github_verified_at_ms: number | string | null;
  github_unavailable_at_ms: number | string | null;
  merge_status: string;
  remote_head_sha: string | null;
  updated_at_ms: number | string;
};

const githubHeaders = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "gx-server",
});

/** Fetch and normalize a PR for canonical identity. */
export async function fetchVerifiedGithubPull(
  db: postgres.Sql,
  repoFullName: string,
  prNumber: number,
): Promise<VerifiedGithubPull | "not_found" | "error"> {
  const grant = await findInstalledRepository(db, repoFullName);
  if (!grant) return "error";

  let token: string;
  try {
    token = await getInstallationAccessToken(grant.installationId);
  } catch {
    return "error";
  }

  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`,
    { headers: githubHeaders(token) },
  );
  if (response.status === 404) return "not_found";
  if (!response.ok) return "error";

  const pull = (await response.json()) as {
    number?: number;
    html_url?: string;
    node_id?: string;
    state?: string;
    merged?: boolean;
    merged_at?: string | null;
    head?: { sha?: string; ref?: string };
    base?: { repo?: { id?: number } };
  };

  const repoId = pull.base?.repo?.id;
  if (
    typeof pull.number !== "number" ||
    !pull.html_url ||
    !pull.node_id ||
    typeof repoId !== "number"
  ) {
    return "error";
  }

  return {
    number: pull.number,
    htmlUrl: pull.html_url,
    nodeId: pull.node_id,
    repoId,
    state: pull.state ?? "open",
    merged: Boolean(pull.merged),
    mergedAt: pull.merged_at ?? null,
    headSha: pull.head?.sha ?? null,
    headRef: pull.head?.ref ?? null,
  };
}

/**
 * Look up an open PR for branch+head. Requires head SHA match when provided
 * so we never attach an unrelated PR that happens to share a branch name.
 */
export async function lookupVerifiedOpenPullForBranch(
  db: postgres.Sql,
  repoFullName: string,
  branchName: string,
  headSha: string | null,
): Promise<VerifiedGithubPull | null> {
  const branch = branchName.trim();
  if (!branch || branch === "HEAD" || branch === "unknown") return null;

  const owner = repoFullName.split("/")[0]?.trim();
  if (!owner) return null;

  const grant = await findInstalledRepository(db, repoFullName);
  if (!grant) return null;

  let token: string;
  try {
    token = await getInstallationAccessToken(grant.installationId);
  } catch {
    return null;
  }

  const head = `${owner}:${branch}`;
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=10`,
    { headers: githubHeaders(token) },
  );
  if (!response.ok) return null;

  const pulls = (await response.json()) as Array<{
    number?: number;
    html_url?: string;
    node_id?: string;
    state?: string;
    merged?: boolean;
    merged_at?: string | null;
    head?: { sha?: string; ref?: string };
    base?: { repo?: { id?: number } };
  }>;

  const matches = pulls.filter((pull) => {
    if (typeof pull.number !== "number" || !pull.html_url || !pull.node_id) {
      return false;
    }
    if (headSha && pull.head?.sha && pull.head.sha !== headSha) {
      return false;
    }
    return typeof pull.base?.repo?.id === "number";
  });

  // Ambiguous: more than one open PR for this head — fail closed.
  if (matches.length !== 1) return null;
  const pull = matches[0]!;
  return {
    number: pull.number!,
    htmlUrl: pull.html_url!,
    nodeId: pull.node_id!,
    repoId: pull.base!.repo!.id!,
    state: pull.state ?? "open",
    merged: Boolean(pull.merged),
    mergedAt: pull.merged_at ?? null,
    headSha: pull.head?.sha ?? null,
    headRef: pull.head?.ref ?? null,
  };
}

const DEPENDENT_TABLES = [
  "pr_comments",
  "decisions",
  "outcomes",
  "summaries",
  "review_usage",
  "change_reviews",
  "issues",
  "conflict_checks",
  "bookmark_ci_checks",
  "review_plans",
] as const;

async function rewireBookmarkDependents(
  tx: SqlExecutor,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) return;

  // Drop colliding unique children before rewiring.
  await tx`
    DELETE FROM bookmark_ci_checks a
    USING bookmark_ci_checks b
    WHERE a.bookmark_id = ${fromId}::uuid
      AND b.bookmark_id = ${toId}::uuid
      AND a.check_name = b.check_name
  `;
  await tx`
    DELETE FROM review_plans a
    USING review_plans b
    WHERE a.bookmark_id = ${fromId}::uuid
      AND b.bookmark_id = ${toId}::uuid
      AND a.head_commit_id = b.head_commit_id
  `;
  await tx`
    DELETE FROM review_usage a
    USING review_usage b
    WHERE a.bookmark_id = ${fromId}::uuid
      AND b.bookmark_id = ${toId}::uuid
      AND a.org_id = b.org_id
  `;
  await tx`
    DELETE FROM change_reviews a
    USING change_reviews b
    WHERE a.bookmark_id = ${fromId}::uuid
      AND b.bookmark_id = ${toId}::uuid
      AND a.org_id = b.org_id
      AND a.stack_index = b.stack_index
  `;
  await tx`
    DELETE FROM issues a
    USING issues b
    WHERE a.bookmark_id = ${fromId}::uuid
      AND b.bookmark_id = ${toId}::uuid
      AND a.source = b.source
      AND a.source_key = b.source_key
  `;

  for (const table of DEPENDENT_TABLES) {
    await tx.unsafe(
      `UPDATE ${table} SET bookmark_id = $1 WHERE bookmark_id = $2::uuid`,
      [toId, fromId],
    );
  }
  await tx`
    UPDATE github_post_skips
    SET bookmark_id = ${toId}::uuid
    WHERE bookmark_id = ${fromId}::uuid
  `;
}

function preferCanonical(
  a: CanonicalBookmark,
  b: CanonicalBookmark,
): CanonicalBookmark {
  const score = (row: CanonicalBookmark) => {
    let s = 0;
    if (row.user_id !== WEBHOOK_BOOKMARK_USER) s += 8;
    if (row.latest_event_id) s += 4;
    if (row.github_verified_at_ms != null) s += 2;
    s += Number(row.updated_at_ms) / 1e15;
    return s;
  };
  return score(a) >= score(b) ? a : b;
}

async function loadBookmark(
  tx: SqlExecutor,
  id: string,
): Promise<CanonicalBookmark | null> {
  const [row] = await tx<CanonicalBookmark[]>`
    SELECT
      id, org_id, user_id, repo_full_name, branch_name, latest_event_id,
      head_commit_id, github_pr_number, github_pr_url, github_repo_id,
      github_pr_node_id, github_verified_at_ms, github_unavailable_at_ms,
      merge_status, remote_head_sha, updated_at_ms
    FROM bookmarks
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Attach a verified GitHub PR to a publisher bookmark and collapse any
 * webhook/duplicate owners of the same PR onto that canonical row.
 */
export async function linkVerifiedPullToBookmark(
  db: postgres.Sql,
  input: {
    orgId: string;
    bookmarkId: string;
    pull: VerifiedGithubPull;
  },
): Promise<CanonicalBookmark | null> {
  return db.begin(async (tx) => {
    const now = Date.now();
    const publisher = await loadBookmark(tx, input.bookmarkId);
    if (!publisher) return null;

    // Lock competitors for this org+repo+pr (and same node id if known).
    const competitors = await tx<CanonicalBookmark[]>`
      SELECT
        id, org_id, user_id, repo_full_name, branch_name, latest_event_id,
        head_commit_id, github_pr_number, github_pr_url, github_repo_id,
        github_pr_node_id, github_verified_at_ms, github_unavailable_at_ms,
        merge_status, remote_head_sha, updated_at_ms
      FROM bookmarks
      WHERE org_id = ${input.orgId}::uuid
        AND repo_full_name = ${publisher.repo_full_name}
        AND (
          github_pr_number = ${input.pull.number}
          OR github_pr_node_id = ${input.pull.nodeId}
          OR id = ${publisher.id}::uuid
        )
      FOR UPDATE
    `;

    let canonical = publisher;
    for (const row of competitors) {
      canonical = preferCanonical(canonical, row);
    }

    // Prefer the publisher bookmark when it has GX evidence.
    if (
      publisher.user_id !== WEBHOOK_BOOKMARK_USER &&
      publisher.latest_event_id
    ) {
      canonical = publisher;
    }

    for (const row of competitors) {
      if (row.id === canonical.id) continue;
      await rewireBookmarkDependents(tx, row.id, canonical.id);
      if (row.user_id === WEBHOOK_BOOKMARK_USER) {
        await tx`DELETE FROM bookmarks WHERE id = ${row.id}::uuid`;
      } else {
        await tx`
          UPDATE bookmarks SET
            github_pr_number = NULL,
            github_pr_url = NULL,
            github_pr_node_id = NULL,
            github_repo_id = NULL,
            github_verified_at_ms = NULL,
            updated_at_ms = ${now}
          WHERE id = ${row.id}::uuid
        `;
      }
    }

    const mergeStatus = input.pull.merged
      ? "merged"
      : input.pull.state === "closed"
        ? "closed"
        : "open";
    const mergedAt =
      input.pull.merged && input.pull.mergedAt
        ? Date.parse(input.pull.mergedAt) || now
        : null;

    const [updated] = await tx<CanonicalBookmark[]>`
      UPDATE bookmarks SET
        github_pr_number = ${input.pull.number},
        github_pr_url = ${input.pull.htmlUrl},
        github_repo_id = ${input.pull.repoId},
        github_pr_node_id = ${input.pull.nodeId},
        github_verified_at_ms = ${now},
        github_unavailable_at_ms = NULL,
        remote_head_sha = COALESCE(${input.pull.headSha}, bookmarks.remote_head_sha),
        merge_status = ${mergeStatus},
        merged_at_ms = CASE
          WHEN ${mergeStatus} = 'merged' THEN COALESCE(${mergedAt}, bookmarks.merged_at_ms, ${now})
          ELSE bookmarks.merged_at_ms
        END,
        updated_at_ms = ${now}
      WHERE id = ${canonical.id}::uuid
      RETURNING
        id, org_id, user_id, repo_full_name, branch_name, latest_event_id,
        head_commit_id, github_pr_number, github_pr_url, github_repo_id,
        github_pr_node_id, github_verified_at_ms, github_unavailable_at_ms,
        merge_status, remote_head_sha, updated_at_ms
    `;

    console.info("canonical PR linked", {
      canonicalId: canonical.id,
      publisherId: publisher.id,
      prNumber: input.pull.number,
      nodeId: input.pull.nodeId,
      competitors: competitors.length,
    });

    return updated ?? null;
  });
}

/** Mark a PR-linked bookmark as unavailable on GitHub (404). */
export async function markGithubPullUnavailable(
  db: postgres.Sql,
  bookmarkId: string,
): Promise<void> {
  const now = Date.now();
  await db`
    UPDATE bookmarks SET
      github_unavailable_at_ms = ${now},
      merge_status = CASE
        WHEN merge_status = 'merged' THEN merge_status
        ELSE 'closed'
      END,
      updated_at_ms = ${now}
    WHERE id = ${bookmarkId}::uuid
  `;
}
