"use node";

import { isRetryableHttpStatus, withRetry } from "./retry";
import { parseFullName } from "./utils";

export async function fetchGithubBlob(
  fullName: string,
  blobSha: string,
  accessToken: string,
): Promise<string | null> {
  const { owner, name } = parseFullName(fullName);

  const response = await withRetry(
    async () => {
      const result = await fetch(
        `https://api.github.com/repos/${owner}/${name}/git/blobs/${blobSha}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "console-app",
          },
        },
      );

      if (isRetryableHttpStatus(result.status)) {
        throw new Error(
          `Failed to fetch blob ${blobSha} for ${fullName} (${result.status})`,
        );
      }

      return result;
    },
    { maxAttempts: 4, baseMs: 1000 },
  );

  if (!response.ok) {
    console.warn(`Failed to fetch blob ${blobSha} for ${fullName}`);
    return null;
  }

  const blob = (await response.json()) as {
    content: string;
    encoding: string;
  };

  if (blob.encoding !== "base64") return null;

  const decoded = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString(
    "utf8",
  );

  if (decoded.includes("\0")) return null;

  return decoded;
}

export async function fetchGithubBlobs(
  fullName: string,
  blobs: Array<{ path: string; sha: string }>,
  accessToken: string,
  concurrency = 10,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let index = 0;

  async function worker() {
    while (index < blobs.length) {
      const current = blobs[index++];
      const content = await fetchGithubBlob(fullName, current.sha, accessToken);
      if (content !== null) {
        results.set(current.path, content);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, blobs.length) }, () => worker()),
  );

  return results;
}
