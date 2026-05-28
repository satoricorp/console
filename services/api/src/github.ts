function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "console-api",
  };
}

export async function getRemoteBranchSha(
  accessToken: string,
  repoFullName: string,
  branch: string,
): Promise<string | null> {
  const encodedRef = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/ref/heads/${encodedRef}`,
    { headers: githubHeaders(accessToken) },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub get branch ref failed (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as {
    object?: { sha?: string };
  };
  return payload.object?.sha ?? null;
}
