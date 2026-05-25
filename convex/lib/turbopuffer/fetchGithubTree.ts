import { isRetryableHttpStatus, withRetry } from "./retry";
import { parseFullName } from "./utils";

export type GithubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
};

export type GithubTreeResult = {
  commitId: string;
  branch: string;
  entries: GithubTreeEntry[];
  truncated: boolean;
};

export async function fetchGithubTree(
  fullName: string,
  accessToken: string,
  commitId?: string,
): Promise<GithubTreeResult> {
  const { owner, name } = parseFullName(fullName);

  const repoResponse = await githubGet(
    `https://api.github.com/repos/${owner}/${name}`,
    accessToken,
  );
  const repo = (await repoResponse.json()) as { default_branch: string };
  const branch = repo.default_branch ?? "main";

  let resolvedCommitId = commitId;
  if (!resolvedCommitId) {
    const refResponse = await githubGet(
      `https://api.github.com/repos/${owner}/${name}/git/ref/heads/${branch}`,
      accessToken,
    );
    const ref = (await refResponse.json()) as { object: { sha: string } };
    resolvedCommitId = ref.object.sha;
  }

  const treeResponse = await githubGet(
    `https://api.github.com/repos/${owner}/${name}/git/trees/${resolvedCommitId}?recursive=1`,
    accessToken,
  );

  if (treeResponse.status === 404) {
    throw new Error(`Tree not found for ${fullName}@${resolvedCommitId}`);
  }

  if (!treeResponse.ok) {
    const body = await treeResponse.text();
    throw new Error(`Failed to fetch tree (${treeResponse.status}): ${body}`);
  }

  const tree = (await treeResponse.json()) as {
    tree: GithubTreeEntry[];
    truncated?: boolean;
  };

  if (tree.truncated) {
    console.warn(`Tree truncated for ${fullName} — indexing partial snapshot`);
  }

  return {
    commitId: resolvedCommitId,
    branch,
    entries: tree.tree.filter((entry) => entry.type === "blob"),
    truncated: tree.truncated ?? false,
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
