import { isRetryableHttpStatus, withRetry } from "./retry";
import { parseFullName } from "./utils";

/**
 * GitHub's cap on how many files it will enumerate for one comparison. Past it
 * the `files` array is silently short, which would read as "nothing else
 * changed" — the one failure mode that leaves the index quietly wrong.
 */
const MAX_COMPARE_FILES = 3000;
const COMPARE_PAGE_SIZE = 100;

export type ComparedFile = {
  path: string;
  /** Set on a rename: the path whose rows now address the wrong file. */
  previousPath?: string;
  removed: boolean;
};

export type GithubCompareResult =
  /** The diff is trustworthy and complete; index exactly these paths. */
  | { usable: true; files: ComparedFile[] }
  /**
   * Fall back to a full pass. `reason` is logged, because "why did this
   * repository just rewrite itself" should never need a debugger to answer.
   */
  | { usable: false; reason: string };

/**
 * What changed in the tree between the last indexed commit and this one.
 *
 * Only a strictly-ahead comparison is accepted. GitHub's `...` compares from the
 * merge base, so on a diverged or rewritten history the file list describes the
 * path from that base — it would omit files that only ever existed on the
 * abandoned side, and their rows would survive in the namespace pointing at code
 * that is no longer anywhere in the repository. A full pass is the honest answer
 * there; it costs one rebuild and the stale sweep cleans up behind it.
 */
export async function fetchGithubCompare(
  fullName: string,
  baseCommitId: string,
  headCommitId: string,
  accessToken: string,
): Promise<GithubCompareResult> {
  const { owner, name } = parseFullName(fullName);
  const files: ComparedFile[] = [];
  let status = "";

  for (let page = 1; page * COMPARE_PAGE_SIZE <= MAX_COMPARE_FILES; page += 1) {
    const url =
      `https://api.github.com/repos/${owner}/${name}/compare/` +
      `${baseCommitId}...${headCommitId}?per_page=${COMPARE_PAGE_SIZE}&page=${page}`;
    const response = await githubGet(url, accessToken);

    // A base commit that GitHub no longer has (garbage-collected after a force
    // push, or never fetched) is a normal outcome, not a failure to shout about.
    if (response.status === 404) {
      return { usable: false, reason: `base commit ${baseCommitId.slice(0, 9)} not found` };
    }
    if (!response.ok) {
      const body = await response.text();
      return {
        usable: false,
        reason: `compare failed (${response.status}): ${body.slice(0, 200)}`,
      };
    }

    const page1 = (await response.json()) as {
      status?: string;
      files?: Array<{ filename: string; status: string; previous_filename?: string }>;
    };
    status ||= page1.status ?? "";
    if (status && status !== "ahead" && status !== "identical") {
      return { usable: false, reason: `history is ${status}, not a fast-forward` };
    }

    const batch = page1.files ?? [];
    for (const file of batch) {
      files.push({
        path: file.filename,
        previousPath: file.previous_filename,
        removed: file.status === "removed",
      });
    }
    if (batch.length < COMPARE_PAGE_SIZE) {
      return { usable: true, files };
    }
  }

  return {
    usable: false,
    reason: `more than ${MAX_COMPARE_FILES} files changed; GitHub stops enumerating`,
  };
}

async function githubGet(url: string, accessToken: string) {
  return withRetry(
    async () => {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "console-app",
        },
      });

      if (isRetryableHttpStatus(response.status)) {
        throw new Error(`GitHub request failed (${response.status}): ${url}`);
      }

      return response;
    },
    { maxAttempts: 4, baseMs: 1000 },
  );
}
