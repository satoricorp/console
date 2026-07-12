import type postgres from "postgres";
// e2e: exercise GX rich PR summary + /reviews visibility
import { getInstallationTokenForRepo } from "./app";

export type GitHubPullFile = {
  filename: string;
  previousFilename: string | null;
  status: string | null;
  patch: string | null;
};

/**
 * Fetch per-file patches for a PR via the GitHub App installation token.
 * Returns [] when the app is not installed or the request fails.
 */
export async function fetchPullRequestFilePatches(
  db: postgres.Sql,
  repoFullName: string,
  pullNumber: number,
): Promise<GitHubPullFile[]> {
  const token = await getInstallationTokenForRepo(db, repoFullName);
  if (!token) return [];

  const files: GitHubPullFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const [owner, repo] = splitRepoFullName(repoFullName);
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
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
      const body = await response.text();
      console.error(
        `fetchPullRequestFilePatches failed (${response.status}): ${body.slice(0, 300)}`,
      );
      return [];
    }
    const payload = (await response.json()) as Array<{
      filename?: string;
      previous_filename?: string;
      status?: string;
      patch?: string;
    }>;
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

/**
 * Wrap GitHub's hunk-only `patch` field into a unified diff that splitUnifiedDiff accepts.
 */
export function githubFilesToUnifiedDiff(files: GitHubPullFile[]): string {
  const parts: string[] = [];
  for (const file of files) {
    if (!file.patch?.trim()) continue;
    const path = file.filename;
    const oldPath =
      file.status === "added"
        ? "/dev/null"
        : file.previousFilename
          ? file.previousFilename
          : path;
    const newPath = file.status === "removed" ? "/dev/null" : path;
    const aPath = oldPath === "/dev/null" ? "/dev/null" : `a/${oldPath}`;
    const bPath = newPath === "/dev/null" ? "/dev/null" : `b/${newPath}`;
    parts.push(
      [
        `diff --git a/${path} b/${path}`,
        file.status === "added" ? "new file mode 100644" : null,
        file.status === "removed" ? "deleted file mode 100644" : null,
        `--- ${aPath}`,
        `+++ ${bPath}`,
        file.patch.replace(/\r\n/g, "\n").trimEnd(),
      ]
        .filter((line): line is string => line != null)
        .join("\n"),
    );
  }
  return parts.join("\n");
}

function splitRepoFullName(repoFullName: string): [string, string] {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name: ${repoFullName}`);
  }
  return [owner, repo];
}
