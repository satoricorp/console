/**
 * GitHub REST helpers for the OSS "watch" rail.
 *
 * The server has no `gh` binary, so these replace the `gh pr view` / `gh pr diff`
 * calls that scripts/outreach.ts uses. Everything reads with the TX bot user's
 * token (TX_WATCH_GITHUB_TOKEN) — a classic `public_repo` PAT or a fine-grained
 * token with read on the watched repos plus pull-request write for posting.
 */

function headers(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tx-watch",
  };
}

export type OpenPull = {
  number: number;
  headSha: string;
  updatedAt: string;
};

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

/** Open PRs, newest-updated first — the poll entrypoint. */
export async function listOpenPulls(
  token: string,
  repoFullName: string,
  perPage = 30,
): Promise<OpenPull[]> {
  const rows = await ghJson<
    Array<{ number: number; updated_at: string; head?: { sha?: string } }>
  >(
    `https://api.github.com/repos/${repoFullName}/pulls?state=open&sort=updated&direction=desc&per_page=${perPage}`,
    token,
  );
  return rows.flatMap((r) =>
    typeof r.number === "number" && r.head?.sha
      ? [{ number: r.number, headSha: r.head.sha, updatedAt: r.updated_at }]
      : [],
  );
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

/** True when the repo is public — the free rail only ever touches public repos. */
export async function isPublicRepo(token: string, repoFullName: string): Promise<boolean> {
  try {
    const repo = await ghJson<{ private?: boolean }>(
      `https://api.github.com/repos/${repoFullName}`,
      token,
    );
    return repo.private === false;
  } catch {
    return false;
  }
}
