/** Markers for TX-owned PR description blocks. */
/** E2E probe: TX PR summary links + /reviews diffs (test/tx-e2e-summary-links). */
export const TX_PR_BODY_MARKER = "<!-- gx:pr-summary:v1 -->";
/** @deprecated Legacy CLI put human notes under this marker below the TX block. */
export const TX_AUTHOR_NOTES_MARKER = "<!-- gx:author-notes -->";
/** @deprecated Legacy header under {@link TX_AUTHOR_NOTES_MARKER}. */
export const TX_AUTHOR_NOTES_HEADER = "## Author Notes";

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gx-server",
  };
}

/** Ensure the summary starts with the TX ownership marker used by split/merge. */
export function ensurePrSummaryMarker(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(TX_PR_BODY_MARKER)) return trimmed;
  return `${TX_PR_BODY_MARKER}\n\n${trimmed}`;
}

/**
 * Strip a trailing legacy Author Notes section from a TX-owned block, returning
 * the notes text (without header/marker).
 */
function extractLegacyAuthorNotes(txOwnedBlock: string): {
  txOnly: string;
  authorNotes: string;
} {
  const idx = txOwnedBlock.indexOf(TX_AUTHOR_NOTES_MARKER);
  if (idx < 0) {
    return { txOnly: txOwnedBlock.trim(), authorNotes: "" };
  }
  let notes = txOwnedBlock.slice(idx + TX_AUTHOR_NOTES_MARKER.length).trim();
  if (notes.startsWith(TX_AUTHOR_NOTES_HEADER)) {
    notes = notes.slice(TX_AUTHOR_NOTES_HEADER.length).trim();
  }
  return {
    txOnly: txOwnedBlock.slice(0, idx).trim(),
    authorNotes: notes,
  };
}

/**
 * Split an existing PR body into the human-written prefix and any TX-owned block.
 *
 * New layout: human text first, then `<!-- gx:pr-summary:v1 -->` … end.
 * Legacy layout (CLI): TX block first, optional `<!-- gx:author-notes -->` below —
 * those notes become the human prefix on the next merge.
 */
export function splitPrBody(existing: string): {
  humanPrefix: string;
  txOwned: boolean;
} {
  const text = existing.replace(/\s+$/, "");
  if (!text.trim()) {
    return { humanPrefix: "", txOwned: false };
  }

  const markerIdx = text.indexOf(TX_PR_BODY_MARKER);
  if (markerIdx < 0) {
    if (text.trimStart().startsWith("Published by TX.")) {
      return { humanPrefix: "", txOwned: true };
    }
    return { humanPrefix: text.trim(), txOwned: false };
  }

  const before = text.slice(0, markerIdx).trim();
  const fromMarker = text.slice(markerIdx);
  const { authorNotes } = extractLegacyAuthorNotes(fromMarker);

  if (!before) {
    // Legacy TX-first body: promote Author Notes (if any) to the human prefix.
    return { humanPrefix: authorNotes, txOwned: true };
  }

  // Human-first body. Ignore a legacy Author Notes trailer if somehow present.
  const human = authorNotes
    ? `${before}\n\n${authorNotes}`.trim()
    : before;
  return { humanPrefix: human, txOwned: true };
}

/**
 * @deprecated Prefer {@link splitPrBody}. Kept for callers/tests that still use
 * the old CLI-shaped `{ authorNotes, txOwned }` result.
 */
export function splitGeneratedPRBody(existing: string): {
  authorNotes: string;
  txOwned: boolean;
} {
  const split = splitPrBody(existing);
  return { authorNotes: split.humanPrefix, txOwned: split.txOwned };
}

/**
 * @deprecated Legacy helper that appended human notes *below* the TX block.
 * New merges keep human text above via {@link mergePrSummaryIntoBody}.
 */
export function appendAuthorNotes(summary: string, notes: string): string {
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) return summary.trim();
  return (
    `${summary.trim()}\n\n` +
    `${TX_AUTHOR_NOTES_MARKER}\n` +
    `${TX_AUTHOR_NOTES_HEADER}\n\n` +
    trimmedNotes
  );
}

/**
 * Merge a fresh TX summary into an existing PR body.
 * Preserves human text above the TX marker; replaces only the TX section.
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
 * Write the TX rich summary into the PR description below any human text.
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

// withUnindexedNotice says when a summary was written without the repository's
// source, and where to fix that.
//
// A summary with no indexed code reads exactly like one with it — same shape,
// same confidence, just thinner and blind to anything the diff does not show.
// That is the failure worth surfacing: the reader cannot tell, and neither can
// we, unless it is stated.
//
// It points at the website rather than at `tx index`, which is a hidden
// maintenance command that fills one developer's namespace from one
// developer's checkout. The index a summary reads is the one TX Cloud
// maintains from the GitHub App on merge, and that is connected on the site.
export function withUnindexedNotice(content: string, sawIndexedCode: boolean): string {
  if (sawIndexedCode) {
    return content;
  }
  return (
    content.trimEnd() +
    "\n\n> This summary was written without " +
    UNINDEXED_NOTICE
  );
}

const UNINDEXED_NOTICE =
  "this repository's source indexed, so it could only see the diff. " +
  "Connect the repository at https://gx.run/repositories to have TX Cloud index it.";
