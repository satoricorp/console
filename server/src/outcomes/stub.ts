export type OutcomeKind = "revert" | "hotfix" | "incident" | "clean";

export type OutcomeDetectionInput = {
  orgId: string;
  bookmarkId: string;
  repoFullName: string;
  ref?: string;
  commitMessage?: string;
  prTitle?: string;
};

export function detectOutcomeStub(input: OutcomeDetectionInput): OutcomeKind | null {
  const haystack = [input.commitMessage, input.prTitle, input.ref]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let kind: OutcomeKind | null = null;
  if (/\brevert\b/.test(haystack)) {
    kind = "revert";
  } else if (/\bhotfix\b/.test(haystack)) {
    kind = "hotfix";
  } else if (/\bincident\b|\bsev[0-9]\b/.test(haystack)) {
    kind = "incident";
  } else if (input.ref === "main" || input.ref === "master") {
    kind = "clean";
  }

  if (kind) {
    console.info("outcomes stub detector", { ...input, kind });
  }

  return kind;
}
