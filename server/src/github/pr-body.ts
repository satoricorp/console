/** Markers for GX-owned PR description blocks. */
export const GX_PR_BODY_MARKER = "<!-- gx:pr-summary:v1 -->";
/** @deprecated Legacy CLI put human notes under this marker below the GX block. */
export const GX_AUTHOR_NOTES_MARKER = "<!-- gx:author-notes -->";
/** @deprecated Legacy header under {@link GX_AUTHOR_NOTES_MARKER}. */
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

/**
 * Strip a trailing legacy Author Notes section from a GX-owned block, returning
 * the notes text (without header/marker).
 */
function extractLegacyAuthorNotes(gxOwnedBlock: string): {
  gxOnly: string;
  authorNotes: string;
} {
  const idx = gxOwnedBlock.indexOf(GX_AUTHOR_NOTES_MARKER);
  if (idx < 0) {
    return { gxOnly: gxOwnedBlock.trim(), authorNotes: "" };
  }
  let notes = gxOwnedBlock.slice(idx + GX_AUTHOR_NOTES_MARKER.length).trim();
  if (notes.startsWith(GX_AUTHOR_NOTES_HEADER)) {
    notes = notes.slice(GX_AUTHOR_NOTES_HEADER.length).trim();
  }
  return {
    gxOnly: gxOwnedBlock.slice(0, idx).trim(),
    authorNotes: notes,
  };
}

/**
 * Split an existing PR body into the human-written prefix and any GX-owned block.
 *
 * New layout: human text first, then `<!-- gx:pr-summary:v1 -->` … end.
 * Legacy layout (CLI): GX block first, optional `<!-- gx:author-notes -->` below —
 * those notes become the human prefix on the next merge.
 */
export function splitPrBody(existing: string): {
  humanPrefix: string;
  gxOwned: boolean;
} {
  const text = existing.replace(/\s+$/, "");
  if (!text.trim()) {
    return { humanPrefix: "", gxOwned: false };
  }

  const markerIdx = text.indexOf(GX_PR_BODY_MARKER);
  if (markerIdx < 0) {
    if (text.trimStart().startsWith("Published by GX.")) {
      return { humanPrefix: "", gxOwned: true };
    }
    return { humanPrefix: text.trim(), gxOwned: false };
  }

  const before = text.slice(0, markerIdx).trim();
  const fromMarker = text.slice(markerIdx);
  const { authorNotes } = extractLegacyAuthorNotes(fromMarker);

  if (!before) {
    // Legacy GX-first body: promote Author Notes (if any) to the human prefix.
    return { humanPrefix: authorNotes, gxOwned: true };
  }

  // Human-first body. Ignore a legacy Author Notes trailer if somehow present.
  const human = authorNotes
    ? `${before}\n\n${authorNotes}`.trim()
    : before;
  return { humanPrefix: human, gxOwned: true };
}

/**
 * @deprecated Prefer {@link splitPrBody}. Kept for callers/tests that still use
 * the old CLI-shaped `{ authorNotes, gxOwned }` result.
 */
export function splitGeneratedPRBody(existing: string): {
  authorNotes: string;
  gxOwned: boolean;
} {
  const split = splitPrBody(existing);
  return { authorNotes: split.humanPrefix, gxOwned: split.gxOwned };
}

/**
 * @deprecated Legacy helper that appended human notes *below* the GX block.
 * New merges keep human text above via {@link mergePrSummaryIntoBody}.
 */
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
 * Merge a fresh GX summary into an existing PR body.
 * Preserves human text above the GX marker; replaces only the GX section.
 */
export function mergePrSummaryIntoBody(
  existingBody: string,
  summary: string,
): string {
  const marked = ensurePrSummaryMarker(summary);
  const { humanPrefix } = splitPrBody(existingBody);
  if (!humanPrefix) {
    return marked;
  }
  return `${humanPrefix}\n\n${marked}`;
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
 * Write the GX rich summary into the PR description below any human text.
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
