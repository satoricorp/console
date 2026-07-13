/** Markers matching the former GX CLI PR body rewrite (`internal/publication/pr_body.go`). */
export const GX_PR_BODY_MARKER = "<!-- gx:pr-summary:v1 -->";
export const GX_AUTHOR_NOTES_MARKER = "<!-- gx:author-notes -->";
export const GX_AUTHOR_NOTES_HEADER = "## Author Notes";

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gx-server",
  };
}

/** Ensure the summary starts with the GX ownership marker used by split/merge. */
export function ensurePrSummaryMarker(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(GX_PR_BODY_MARKER)) return trimmed;
  return `${GX_PR_BODY_MARKER}\n\n${trimmed}`;
}

export function appendAuthorNotes(summary: string, notes: string): string {
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) return summary.trim();
  return (
    `${summary.trim()}\n\n` +
    `${GX_AUTHOR_NOTES_MARKER}\n` +
    `${GX_AUTHOR_NOTES_HEADER}\n\n` +
    trimmedNotes
  );
}

/**
 * Split an existing PR body into preserved author notes vs GX-owned content.
 * Port of gx CLI `splitGeneratedPRBody`.
 */
export function splitGeneratedPRBody(existing: string): {
  authorNotes: string;
  gxOwned: boolean;
} {
  const trimmed = existing.trim();
  if (!trimmed) {
    return { authorNotes: "", gxOwned: true };
  }
  if (trimmed.startsWith(GX_PR_BODY_MARKER)) {
    const idx = trimmed.indexOf(GX_AUTHOR_NOTES_MARKER);
    if (idx >= 0) {
      let notes = trimmed.slice(idx + GX_AUTHOR_NOTES_MARKER.length).trim();
      if (notes.startsWith(GX_AUTHOR_NOTES_HEADER)) {
        notes = notes.slice(GX_AUTHOR_NOTES_HEADER.length).trim();
      }
      return { authorNotes: notes, gxOwned: true };
    }
    return { authorNotes: "", gxOwned: true };
  }
  if (trimmed.startsWith("Published by GX.")) {
    return { authorNotes: "", gxOwned: true };
  }
  return { authorNotes: trimmed, gxOwned: false };
}

/**
 * Merge a fresh GX summary into an existing PR body, preserving human author notes.
 * Port of gx CLI `UpdateGitHubPullRequestBody` merge logic.
 */
export function mergePrSummaryIntoBody(
  existingBody: string,
  summary: string,
): string {
  const marked = ensurePrSummaryMarker(summary);
  let { authorNotes, gxOwned } = splitGeneratedPRBody(existingBody);
  let desired = appendAuthorNotes(marked, authorNotes);
  if (!gxOwned && !authorNotes.trim()) {
    authorNotes = existingBody.trim();
    desired = appendAuthorNotes(marked, authorNotes);
  }
  return desired;
}

export async function getPullRequestBody(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}`,
    { headers: githubHeaders(accessToken) },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub get pull request failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  const payload = JSON.parse(text) as { body?: string | null };
  return typeof payload.body === "string" ? payload.body : "";
}

export async function updatePullRequestBody(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
  body: string,
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}`,
    {
      method: "PATCH",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub update pull request body failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
}

/**
 * Write the GX rich summary into the PR description, preserving author notes.
 * Returns whether the body changed.
 */
export async function updatePullRequestWithSummary(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
  summary: string,
): Promise<{ updated: boolean; body: string }> {
  const existing = await getPullRequestBody(
    accessToken,
    repoFullName,
    pullNumber,
  );
  const desired = mergePrSummaryIntoBody(existing, summary);
  if (existing.trim() === desired.trim()) {
    return { updated: false, body: desired };
  }
  await updatePullRequestBody(accessToken, repoFullName, pullNumber, desired);
  return { updated: true, body: desired };
}
