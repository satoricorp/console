/**
 * GitHub REST helpers for sessionless PR summaries (summary/external.ts).
 *
 * The server has no `gh` binary, so these replace the `gh pr view` / `gh pr diff`
 * calls that scripts/outreach.ts uses. Every call takes its token as an argument
 * rather than reading one from the environment, so a caller can use whichever
 * identity it has.
 *
 * Written for the OSS "watch" rail, which has since been removed; the poll-side
 * helpers (listOpenPulls, isPublicRepo) went with it. The read helpers below
 * outlived it because generating a summary for a PR nobody has a session for is
 * useful on its own.
 */

function headers(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gx-watch",
  };
}

export type PullMeta = {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  htmlUrl: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
};

export type PullFile = { path: string; additions: number; deletions: number };
export type IssueComment = { author: string; body: string };

async function ghJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: headers(token) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub GET ${url} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export async function fetchPullMeta(
  token: string,
  repoFullName: string,
  number: number,
): Promise<PullMeta> {
  const pr = await ghJson<{
    number: number;
    title?: string;
    body?: string | null;
    user?: { login?: string };
    state?: string;
    html_url?: string;
    base?: { ref?: string };
    head?: { ref?: string; sha?: string };
    additions?: number;
    deletions?: number;
    changed_files?: number;
  }>(`https://api.github.com/repos/${repoFullName}/pulls/${number}`, token);

  return {
    number,
    title: pr.title ?? "",
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    state: pr.state ?? "open",
    htmlUrl: pr.html_url ?? `https://github.com/${repoFullName}/pull/${number}`,
    baseRef: pr.base?.ref ?? "",
    headRef: pr.head?.ref ?? "",
    headSha: pr.head?.sha ?? "",
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changed_files ?? 0,
  };
}

/** Raw unified diff via the diff media type (replaces `gh pr diff`). */
export async function fetchPullDiff(
  token: string,
  repoFullName: string,
  number: number,
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${number}`,
    { headers: headers(token, "application/vnd.github.v3.diff") },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub diff ${repoFullName}#${number} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return text;
}

export async function fetchPullFiles(
  token: string,
  repoFullName: string,
  number: number,
): Promise<PullFile[]> {
  const rows = await ghJson<
    Array<{ filename?: string; additions?: number; deletions?: number }>
  >(
    `https://api.github.com/repos/${repoFullName}/pulls/${number}/files?per_page=100`,
    token,
  );
  return rows.flatMap((f) =>
    f.filename
      ? [{ path: f.filename, additions: f.additions ?? 0, deletions: f.deletions ?? 0 }]
      : [],
  );
}

/** Conversation (issue) comments — used for competitor/coverage detection. */
export async function fetchIssueComments(
  token: string,
  repoFullName: string,
  number: number,
): Promise<IssueComment[]> {
  try {
    const rows = await ghJson<Array<{ user?: { login?: string }; body?: string }>>(
      `https://api.github.com/repos/${repoFullName}/issues/${number}/comments?per_page=100`,
      token,
    );
    return rows.map((c) => ({ author: c.user?.login ?? "", body: c.body ?? "" }));
  } catch {
    return [];
  }
}
