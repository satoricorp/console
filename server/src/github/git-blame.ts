import type postgres from "postgres";
import { getInstallationAccessToken } from "./app";

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

type PullRequestMeta = {
  baseSha: string;
  headSha: string;
  baseRef: string | null;
  headRef: string | null;
  htmlUrl: string | null;
};

type PullRequestFile = {
  filename: string;
  previousFilename: string | null;
  status: string | null;
  patch: string | null;
};

type PullRequestCommit = {
  sha: string;
  parentShas: string[];
  authoredAtMs: number | null;
  authorLogin: string | null;
  messageHeadline: string | null;
  commitUrl: string | null;
};

export type ParsedPatchHunk = {
  oldStart: number;
  oldLength: number;
  oldEnd: number | null;
  newStart: number;
  newLength: number;
  newEnd: number | null;
};

type GitHubBlameRange = {
  lineStart: number;
  lineEnd: number;
  age: number | null;
  commitSha: string;
  commitUrl: string | null;
  authoredAtMs: number | null;
  authorLogin: string | null;
  authorName: string | null;
  messageHeadline: string | null;
  associatedPrNumber: number | null;
  associatedPrUrl: string | null;
};

type HunkLinkForMatch = {
  file: string;
  line_start: number;
  line_end: number;
  session_id: string;
  authorship: string;
  confidence: number;
  tool: string | null;
  model: string | null;
};

export type GitBlameContextRow = {
  filePath: string;
  previousFilePath: string | null;
  oldStart: number | null;
  oldEnd: number | null;
  newStart: number | null;
  newEnd: number | null;
  blameLineStart: number;
  blameLineEnd: number;
  commitSha: string;
  commitUrl: string | null;
  authoredAtMs: number | null;
  authorLogin: string | null;
  authorName: string | null;
  messageHeadline: string | null;
  associatedPrNumber: number | null;
  associatedPrUrl: string | null;
  codeUrl: string | null;
  gxEventIds: string[];
  gxSessionIds: string[];
  gxSessionEvents: Array<{
    sessionId: string;
    eventType: string;
    filePath: string | null;
    rawLine: number | null;
    tool: string;
    model: string | null;
  }>;
};

export type GitBlameContext = {
  source: "git_blame";
  repoFullName: string;
  pullNumber: number;
  baseSha: string;
  headSha: string;
  rows: GitBlameContextRow[];
};

export type LoadGitBlameContextInput = {
  orgId: string;
  repoFullName: string;
  pullNumber: number;
  installationId: number;
  eventId: string;
  fileHints?: string[];
};

type GraphQLBlameResponse = {
  errors?: Array<{ message?: string }>;
  data?: {
    repository?: {
      object?: {
        blame?: {
          ranges?: Array<{
            startingLine?: number;
            endingLine?: number;
            age?: number;
            commit?: {
              oid?: string;
              commitUrl?: string;
              authoredDate?: string;
              messageHeadline?: string;
              author?: {
                name?: string | null;
                user?: { login?: string | null } | null;
              } | null;
              associatedPullRequests?: {
                nodes?: Array<{
                  number?: number;
                  url?: string;
                }>;
              };
            };
          }>;
        };
      } | null;
    } | null;
  };
};

export function parsePatchHunks(patch: string | null | undefined): ParsedPatchHunk[] {
  if (!patch) return [];
  const hunks: ParsedPatchHunk[] = [];
  const headerRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (const line of patch.split("\n")) {
    const match = headerRe.exec(line);
    if (!match) continue;
    const oldStart = Number(match[1]);
    const oldLength = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLength = match[4] === undefined ? 1 : Number(match[4]);
    hunks.push({
      oldStart,
      oldLength,
      oldEnd: oldLength > 0 ? oldStart + oldLength - 1 : null,
      newStart,
      newLength,
      newEnd: newLength > 0 ? newStart + newLength - 1 : null,
    });
  }
  return hunks;
}

export async function loadGitBlameContext(
  db: postgres.Sql,
  input: LoadGitBlameContextInput,
): Promise<GitBlameContext | null> {
  try {
    const accessToken = await getInstallationAccessToken(input.installationId);
    const pr = await fetchPullRequestMeta(accessToken, input.repoFullName, input.pullNumber);
    const [files, commits] = await Promise.all([
      fetchPullRequestFiles(accessToken, input.repoFullName, input.pullNumber),
      fetchPullRequestCommits(accessToken, input.repoFullName, input.pullNumber),
    ]);

    await persistPrEventCommits(db, {
      orgId: input.orgId,
      eventId: input.eventId,
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
      commits,
    });
    await persistPrEventHunks(db, {
      orgId: input.orgId,
      eventId: input.eventId,
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      files,
    });

    const oldFilePaths = await selectBlameFilePaths(db, {
      orgId: input.orgId,
      eventId: input.eventId,
      repoFullName: input.repoFullName,
      fileHints: input.fileHints ?? [],
    });
    for (const filePath of oldFilePaths) {
      try {
        await ensureBlameSnapshot(db, {
          accessToken,
          orgId: input.orgId,
          repoFullName: input.repoFullName,
          refSha: pr.baseSha,
          filePath,
        });
      } catch (error) {
        console.info("git_blame file unavailable", {
          orgId: input.orgId,
          repoFullName: input.repoFullName,
          pullNumber: input.pullNumber,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const rows = await loadCachedGitBlameRows(db, {
      orgId: input.orgId,
      eventId: input.eventId,
      repoFullName: input.repoFullName,
      baseSha: pr.baseSha,
    });

    return {
      source: "git_blame",
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      rows,
    };
  } catch (error) {
    console.info("git_blame context unavailable", {
      orgId: input.orgId,
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchPullRequestMeta(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<PullRequestMeta> {
  const payload = await githubRestJson<{
    html_url?: string;
    base?: { sha?: string; ref?: string };
    head?: { sha?: string; ref?: string };
  }>(accessToken, repoFullName, `/pulls/${pullNumber}`);
  const baseSha = payload.base?.sha;
  const headSha = payload.head?.sha;
  if (!baseSha || !headSha) {
    throw new Error("GitHub pull request response missing base/head sha");
  }
  return {
    baseSha,
    headSha,
    baseRef: payload.base?.ref ?? null,
    headRef: payload.head?.ref ?? null,
    htmlUrl: payload.html_url ?? null,
  };
}

async function fetchPullRequestFiles(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const payload = await githubRestJson<Array<{
      filename?: string;
      previous_filename?: string;
      status?: string;
      patch?: string;
    }>>(
      accessToken,
      repoFullName,
      `/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );
    for (const file of payload) {
      if (!file.filename) continue;
      files.push({
        filename: file.filename,
        previousFilename: file.previous_filename ?? null,
        status: file.status ?? null,
        patch: file.patch ?? null,
      });
    }
    if (payload.length < 100) break;
  }
  return files;
}

async function fetchPullRequestCommits(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<PullRequestCommit[]> {
  const commits: PullRequestCommit[] = [];
  for (let page = 1; page <= 3; page++) {
    const payload = await githubRestJson<Array<{
      sha?: string;
      html_url?: string;
      parents?: Array<{ sha?: string }>;
      author?: { login?: string } | null;
      commit?: {
        message?: string;
        author?: { date?: string };
      };
    }>>(
      accessToken,
      repoFullName,
      `/pulls/${pullNumber}/commits?per_page=100&page=${page}`,
    );
    for (const commit of payload) {
      if (!commit.sha) continue;
      commits.push({
        sha: commit.sha,
        parentShas: (commit.parents?.map((parent) => parent.sha).filter(Boolean) as string[] | undefined) ?? [],
        authoredAtMs: parseTimestampMs(commit.commit?.author?.date),
        authorLogin: commit.author?.login ?? null,
        messageHeadline: firstLine(commit.commit?.message),
        commitUrl: commit.html_url ?? null,
      });
    }
    if (payload.length < 100) break;
  }
  return commits;
}

async function fetchGitHubBlame(
  accessToken: string,
  repoFullName: string,
  refSha: string,
  filePath: string,
): Promise<GitHubBlameRange[]> {
  const [owner, repo] = splitRepoFullName(repoFullName);
  const query = `
    query GxGitBlame($owner: String!, $repo: String!, $expression: String!, $path: String!) {
      repository(owner: $owner, name: $repo) {
        object(expression: $expression) {
          ... on Commit {
            blame(path: $path) {
              ranges {
                startingLine
                endingLine
                age
                commit {
                  oid
                  commitUrl
                  authoredDate
                  messageHeadline
                  author {
                    name
                    user {
                      login
                    }
                  }
                  associatedPullRequests(first: 1) {
                    nodes {
                      number
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: githubHeaders(accessToken),
    body: JSON.stringify({
      query,
      variables: { owner, repo, expression: refSha, path: filePath },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub blame query failed (${response.status}): ${text.slice(0, 500)}`);
  }
  const payload = JSON.parse(text) as GraphQLBlameResponse;
  if (payload.errors?.length) {
    throw new Error(
      `GitHub blame query failed: ${payload.errors.map((e) => e.message ?? "unknown").join("; ")}`,
    );
  }
  const ranges = payload.data?.repository?.object?.blame?.ranges ?? [];
  return ranges.flatMap((range) => {
    const commit = range.commit;
    const commitSha = commit?.oid;
    const lineStart = range.startingLine;
    const lineEnd = range.endingLine;
    if (!commitSha || typeof lineStart !== "number" || typeof lineEnd !== "number") {
      return [];
    }
    const associatedPr = commit?.associatedPullRequests?.nodes?.[0];
    return [{
      lineStart,
      lineEnd,
      age: typeof range.age === "number" ? range.age : null,
      commitSha,
      commitUrl: commit?.commitUrl ?? null,
      authoredAtMs: parseTimestampMs(commit?.authoredDate),
      authorLogin: commit?.author?.user?.login ?? null,
      authorName: commit?.author?.name ?? null,
      messageHeadline: commit?.messageHeadline ?? null,
      associatedPrNumber: typeof associatedPr?.number === "number" ? associatedPr.number : null,
      associatedPrUrl: associatedPr?.url ?? null,
    }];
  });
}

async function persistPrEventCommits(
  db: SqlExecutor,
  input: {
    orgId: string;
    eventId: string;
    repoFullName: string;
    pullNumber: number;
    commits: PullRequestCommit[];
  },
) {
  const now = Date.now();
  for (const commit of input.commits) {
    await db`
      INSERT INTO pr_event_commits (
        org_id,
        pr_event_id,
        repo_full_name,
        pr_number,
        commit_sha,
        parent_shas,
        authored_at_ms,
        author_login,
        message_headline,
        commit_url,
        created_at_ms
      ) VALUES (
        ${input.orgId},
        ${input.eventId},
        ${input.repoFullName},
        ${input.pullNumber},
        ${commit.sha},
        ${commit.parentShas},
        ${commit.authoredAtMs},
        ${commit.authorLogin},
        ${commit.messageHeadline},
        ${commit.commitUrl},
        ${now}
      )
      ON CONFLICT (pr_event_id, commit_sha) DO UPDATE SET
        parent_shas = EXCLUDED.parent_shas,
        authored_at_ms = EXCLUDED.authored_at_ms,
        author_login = EXCLUDED.author_login,
        message_headline = EXCLUDED.message_headline,
        commit_url = EXCLUDED.commit_url
    `;
  }
}

async function persistPrEventHunks(
  db: SqlExecutor,
  input: {
    orgId: string;
    eventId: string;
    repoFullName: string;
    pullNumber: number;
    baseSha: string;
    headSha: string;
    files: PullRequestFile[];
  },
) {
  const links = await db<HunkLinkForMatch[]>`
    SELECT file, line_start, line_end, session_id, authorship, confidence, tool, model
    FROM hunk_links
    WHERE org_id = ${input.orgId}
      AND event_id = ${input.eventId}
  `;

  await db`
    DELETE FROM pr_event_hunks
    WHERE org_id = ${input.orgId}
      AND pr_event_id = ${input.eventId}
  `;

  const now = Date.now();
  for (const file of input.files) {
    for (const hunk of parsePatchHunks(file.patch)) {
      const matched = matchHunkLink(links, file.filename, hunk);
      const oldRangeStart = hunk.oldStart;
      const oldRangeEnd = hunk.oldStart + hunk.oldLength;
      const newRangeStart = hunk.newStart;
      const newRangeEnd = hunk.newStart + hunk.newLength;
      await db`
        INSERT INTO pr_event_hunks (
          org_id,
          pr_event_id,
          repo_full_name,
          pr_number,
          base_sha,
          head_sha,
          file_path,
          previous_file_path,
          status,
          old_start,
          old_end,
          new_start,
          new_end,
          old_line_range,
          new_line_range,
          session_id,
          authorship,
          confidence,
          tool,
          model,
          created_at_ms
        ) VALUES (
          ${input.orgId},
          ${input.eventId},
          ${input.repoFullName},
          ${input.pullNumber},
          ${input.baseSha},
          ${input.headSha},
          ${file.filename},
          ${file.previousFilename},
          ${file.status},
          ${hunk.oldLength > 0 ? hunk.oldStart : null},
          ${hunk.oldEnd},
          ${hunk.newLength > 0 ? hunk.newStart : null},
          ${hunk.newEnd},
          int4range(${oldRangeStart}, ${oldRangeEnd}, '[)'),
          int4range(${newRangeStart}, ${newRangeEnd}, '[)'),
          ${matched?.session_id ?? null},
          ${matched?.authorship ?? null},
          ${matched?.confidence ?? null},
          ${matched?.tool ?? null},
          ${matched?.model ?? null},
          ${now}
        )
      `;
    }
  }
}

async function selectBlameFilePaths(
  db: SqlExecutor,
  input: {
    orgId: string;
    eventId: string;
    repoFullName: string;
    fileHints: string[];
  },
): Promise<string[]> {
  const hints = [...new Set(input.fileHints.filter(Boolean))];
  const rows = hints.length > 0
    ? await db<{ file_path: string }[]>`
        SELECT DISTINCT COALESCE(previous_file_path, file_path) AS file_path
        FROM pr_event_hunks
        WHERE org_id = ${input.orgId}
          AND pr_event_id = ${input.eventId}
          AND repo_full_name = ${input.repoFullName}
          AND file_path = ANY(${hints})
          AND NOT isempty(old_line_range)
        ORDER BY file_path
        LIMIT 3
      `
    : await db<{ file_path: string }[]>`
        SELECT DISTINCT COALESCE(previous_file_path, file_path) AS file_path
        FROM pr_event_hunks
        WHERE org_id = ${input.orgId}
          AND pr_event_id = ${input.eventId}
          AND repo_full_name = ${input.repoFullName}
          AND NOT isempty(old_line_range)
        ORDER BY file_path
        LIMIT 3
      `;
  return rows.map((row) => row.file_path);
}

async function ensureBlameSnapshot(
  db: SqlExecutor,
  input: {
    accessToken: string;
    orgId: string;
    repoFullName: string;
    refSha: string;
    filePath: string;
  },
) {
  const [existing] = await db<{ id: string; status: string }[]>`
    SELECT id, status
    FROM git_blame_snapshots
    WHERE org_id = ${input.orgId}
      AND repo_full_name = ${input.repoFullName}
      AND ref_sha = ${input.refSha}
      AND file_path = ${input.filePath}
    LIMIT 1
  `;
  if (existing?.status === "ok") {
    return existing.id;
  }

  const now = Date.now();
  let ranges: GitHubBlameRange[];
  try {
    ranges = await fetchGitHubBlame(
      input.accessToken,
      input.repoFullName,
      input.refSha,
      input.filePath,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db`
      INSERT INTO git_blame_snapshots (
        org_id,
        repo_full_name,
        ref_sha,
        file_path,
        source_provider,
        fetched_at_ms,
        status,
        error_message
      ) VALUES (
        ${input.orgId},
        ${input.repoFullName},
        ${input.refSha},
        ${input.filePath},
        'github_graphql',
        ${now},
        'error',
        ${message.slice(0, 500)}
      )
      ON CONFLICT (org_id, repo_full_name, ref_sha, file_path) DO UPDATE SET
        fetched_at_ms = EXCLUDED.fetched_at_ms,
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message
    `;
    throw error;
  }
  const [snapshot] = await db<{ id: string }[]>`
    INSERT INTO git_blame_snapshots (
      org_id,
      repo_full_name,
      ref_sha,
      file_path,
      source_provider,
      fetched_at_ms,
      status,
      error_message
    ) VALUES (
      ${input.orgId},
      ${input.repoFullName},
      ${input.refSha},
      ${input.filePath},
      'github_graphql',
      ${now},
      'ok',
      NULL
    )
    ON CONFLICT (org_id, repo_full_name, ref_sha, file_path) DO UPDATE SET
      fetched_at_ms = EXCLUDED.fetched_at_ms,
      status = EXCLUDED.status,
      error_message = NULL
    RETURNING id
  `;
  await db`
    DELETE FROM git_blame_ranges
    WHERE snapshot_id = ${snapshot.id}
  `;
  for (const range of ranges) {
    await db`
      INSERT INTO git_blame_ranges (
        snapshot_id,
        org_id,
        repo_full_name,
        file_path,
        line_start,
        line_end,
        line_range,
        commit_sha,
        commit_url,
        authored_at_ms,
        author_login,
        author_name,
        message_headline,
        associated_pr_number,
        associated_pr_url,
        age
      ) VALUES (
        ${snapshot.id},
        ${input.orgId},
        ${input.repoFullName},
        ${input.filePath},
        ${range.lineStart},
        ${range.lineEnd},
        int4range(${range.lineStart}, ${range.lineEnd + 1}, '[)'),
        ${range.commitSha},
        ${range.commitUrl},
        ${range.authoredAtMs},
        ${range.authorLogin},
        ${range.authorName},
        ${range.messageHeadline},
        ${range.associatedPrNumber},
        ${range.associatedPrUrl},
        ${range.age}
      )
      ON CONFLICT (snapshot_id, line_start, line_end, commit_sha) DO NOTHING
    `;
  }
  return snapshot.id;
}

async function loadCachedGitBlameRows(
  db: SqlExecutor,
  input: {
    orgId: string;
    eventId: string;
    repoFullName: string;
    baseSha: string;
  },
): Promise<GitBlameContextRow[]> {
  const rows = await db<Array<{
    file_path: string;
    previous_file_path: string | null;
    old_start: number | null;
    old_end: number | null;
    new_start: number | null;
    new_end: number | null;
    line_start: number;
    line_end: number;
    commit_sha: string;
    commit_url: string | null;
    authored_at_ms: string | number | null;
    author_login: string | null;
    author_name: string | null;
    message_headline: string | null;
    associated_pr_number: number | null;
    associated_pr_url: string | null;
  }>>`
    SELECT
      h.file_path,
      h.previous_file_path,
      h.old_start,
      h.old_end,
      h.new_start,
      h.new_end,
      br.line_start,
      br.line_end,
      br.commit_sha,
      br.commit_url,
      br.authored_at_ms,
      br.author_login,
      br.author_name,
      br.message_headline,
      br.associated_pr_number,
      br.associated_pr_url
    FROM pr_event_hunks h
    JOIN git_blame_snapshots s
      ON s.org_id = h.org_id
     AND s.repo_full_name = h.repo_full_name
     AND s.ref_sha = h.base_sha
     AND s.file_path = COALESCE(h.previous_file_path, h.file_path)
     AND s.status = 'ok'
    JOIN git_blame_ranges br
      ON br.snapshot_id = s.id
     AND br.line_range && h.old_line_range
    WHERE h.org_id = ${input.orgId}
      AND h.pr_event_id = ${input.eventId}
      AND h.repo_full_name = ${input.repoFullName}
      AND h.base_sha = ${input.baseSha}
      AND NOT isempty(h.old_line_range)
    ORDER BY h.file_path, h.old_start, br.line_start
    LIMIT 30
  `;

  const commitShas = [...new Set(rows.map((row) => row.commit_sha))];
  const provenance = commitShas.length > 0
    ? await loadTxProvenance(db, input.orgId, input.repoFullName, commitShas)
    : new Map<string, {
        eventIds: string[];
        sessionIds: string[];
        sessionEvents: GitBlameContextRow["gxSessionEvents"];
      }>();

  return rows.map((row) => {
    const oldPath = row.previous_file_path ?? row.file_path;
    const codeUrl =
      row.commit_sha && row.line_start > 0
        ? `https://github.com/${input.repoFullName}/blob/${row.commit_sha}/${oldPath}#L${row.line_start}-L${row.line_end}`
        : null;
    const gx = provenance.get(row.commit_sha);
    return {
      filePath: row.file_path,
      previousFilePath: row.previous_file_path,
      oldStart: row.old_start,
      oldEnd: row.old_end,
      newStart: row.new_start,
      newEnd: row.new_end,
      blameLineStart: row.line_start,
      blameLineEnd: row.line_end,
      commitSha: row.commit_sha,
      commitUrl: row.commit_url,
      authoredAtMs: row.authored_at_ms == null ? null : Number(row.authored_at_ms),
      authorLogin: row.author_login,
      authorName: row.author_name,
      messageHeadline: row.message_headline,
      associatedPrNumber: row.associated_pr_number,
      associatedPrUrl: row.associated_pr_url,
      codeUrl,
      gxEventIds: gx?.eventIds ?? [],
      gxSessionIds: gx?.sessionIds ?? [],
      gxSessionEvents: gx?.sessionEvents ?? [],
    };
  });
}

async function loadTxProvenance(
  db: SqlExecutor,
  orgId: string,
  repoFullName: string,
  commitShas: string[],
): Promise<Map<string, {
  eventIds: string[];
  sessionIds: string[];
  sessionEvents: GitBlameContextRow["gxSessionEvents"];
}>> {
  const rows = await db<Array<{
    commit_sha: string;
    event_id: string;
    session_id: string | null;
    event_type: string | null;
    file_path: string | null;
    raw_line: number | null;
    tool: string | null;
    model: string | null;
  }>>`
    SELECT DISTINCT
      COALESCE(pec.commit_sha, e.head_commit_id) AS commit_sha,
      e.id AS event_id,
      hl.session_id,
      se.event_type,
      se.file_path,
      se.raw_line,
      se.tool,
      se.model
    FROM pr_events e
    LEFT JOIN pr_event_commits pec
      ON pec.pr_event_id = e.id
     AND pec.org_id = e.org_id
    LEFT JOIN hunk_links hl
      ON hl.org_id = e.org_id
     AND hl.event_id = e.id
    LEFT JOIN session_events se
      ON se.org_id = e.org_id
     AND se.session_id = hl.session_id
    WHERE e.org_id = ${orgId}
      AND (e.head_commit_id = ANY(${commitShas}) OR pec.commit_sha = ANY(${commitShas}))
      AND (
        pec.repo_full_name = ${repoFullName}
        OR e.id IN (
          SELECT b.latest_event_id
          FROM bookmarks b
          WHERE b.org_id = ${orgId}
            AND b.repo_full_name = ${repoFullName}
            AND b.latest_event_id IS NOT NULL
        )
      )
    ORDER BY event_id, session_id NULLS LAST, raw_line NULLS LAST
    LIMIT 100
  `;

  const byCommit = new Map<string, {
    eventIds: Set<string>;
    sessionIds: Set<string>;
    sessionEvents: GitBlameContextRow["gxSessionEvents"];
  }>();
  for (const row of rows) {
    if (!row.commit_sha) continue;
    const entry = byCommit.get(row.commit_sha) ?? {
      eventIds: new Set<string>(),
      sessionIds: new Set<string>(),
      sessionEvents: [],
    };
    entry.eventIds.add(row.event_id);
    if (row.session_id) entry.sessionIds.add(row.session_id);
    if (row.session_id && row.event_type && row.tool) {
      entry.sessionEvents.push({
        sessionId: row.session_id,
        eventType: row.event_type,
        filePath: row.file_path,
        rawLine: row.raw_line,
        tool: row.tool,
        model: row.model,
      });
    }
    byCommit.set(row.commit_sha, entry);
  }

  const out = new Map<string, {
    eventIds: string[];
    sessionIds: string[];
    sessionEvents: GitBlameContextRow["gxSessionEvents"];
  }>();
  for (const [commit, entry] of byCommit) {
    out.set(commit, {
      eventIds: [...entry.eventIds].slice(0, 5),
      sessionIds: [...entry.sessionIds].slice(0, 5),
      sessionEvents: entry.sessionEvents.slice(0, 10),
    });
  }
  return out;
}

function matchHunkLink(
  links: HunkLinkForMatch[],
  filePath: string,
  hunk: ParsedPatchHunk,
): HunkLinkForMatch | null {
  if (hunk.newEnd == null) return null;
  const newEnd = hunk.newEnd;
  return links.find((link) =>
    link.file === filePath &&
    rangesOverlap(link.line_start, link.line_end, hunk.newStart, newEnd),
  ) ?? null;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

async function githubRestJson<T>(
  accessToken: string,
  repoFullName: string,
  pathAndQuery: string,
): Promise<T> {
  const [owner, repo] = splitRepoFullName(repoFullName);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${pathAndQuery}`,
    { headers: githubHeaders(accessToken) },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub REST request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gx-server",
  };
}

function splitRepoFullName(repoFullName: string): [string, string] {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name: ${repoFullName}`);
  }
  return [owner, repo];
}

function firstLine(message: string | undefined): string | null {
  return message?.split("\n")[0]?.trim() || null;
}

function parseTimestampMs(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
