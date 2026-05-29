export function parseGithubPrNumber(githubPrUrl: string | null): number | null {
  if (!githubPrUrl) return null;
  const match = githubPrUrl.match(/\/pull\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function repoFullNameFromRemoteUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export function branchSlugTitle(branchName: string): string {
  const slug = branchName.split("/").at(-1) ?? branchName;
  const words = slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return branchName;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

/** Title for a bookmark row: current change, else top-of-stack, else branch slug. */
export function inferBookmarkTitle(
  payload: {
    change?: { description?: string };
    stack?: Array<{ change?: { description?: string } }>;
  },
  branchName: string,
): string {
  const changeLine = payload.change?.description?.split("\n")[0]?.trim();
  if (changeLine) return changeLine;

  const stack = payload.stack;
  if (Array.isArray(stack) && stack.length > 0) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const firstLine = stack[index]?.change?.description?.split("\n")[0]?.trim();
      if (firstLine) return firstLine;
    }
  }

  return branchSlugTitle(branchName);
}
