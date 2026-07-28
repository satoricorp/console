import { createHash } from "node:crypto";
import type postgres from "postgres";
import {
  contextBrokerEnabled,
  reviewKnowledgeNamespace,
} from "../indexing/config";
import { searchIndex, embedQueryText, type IndexSearchResult } from "../indexing/turbopuffer";
import { getInstallationTokenForRepo } from "../github/app";

export type ContextBucket =
  | "agent-sessions"
  | "codebase"
  | "previous-prs"
  | "docs";

export type ContextSnippet = {
  id: string;
  citationId: string;
  bucket: ContextBucket;
  sourceKind: string;
  text: string;
  score?: number;
  file?: string;
  /**
   * A concrete, real identifier for the snippet's source, shown in the prompt
   * so an attribution can name something that exists. Prior-PR rows carry no
   * GitHub PR number — only a branch and a head SHA — so this is what the model
   * is given to cite instead of a number it would have to invent.
   */
  ref?: string;
};

export type ContextManifestEntry = {
  provided: number;
  chars: number;
  label?: string;
};

export type ReviewContextBrokerResult = {
  buckets: Record<ContextBucket, ContextSnippet[]>;
  manifest: Record<ContextBucket, ContextManifestEntry>;
  reviewMdPresent: boolean;
};

export const BUCKET_SOURCE_KINDS: Record<ContextBucket, string[]> = {
  "agent-sessions": [
    "published_session_context",
    "session_transcript",
    "session_context",
  ],
  codebase: ["code_file", "push_delta", "hunk_link"],
  "previous-prs": [
    "published_revision_diff",
    "code_review_summary",
    "code_review_history",
  ],
  docs: ["review_policy", "review_corpus"],
};

const DEFAULT_PER_BUCKET = 8;
const DEFAULT_SNIPPET_CHARS = 1200;
const DEFAULT_TOTAL_CHARS = 10_000;
const REVIEW_MD_MAX_BYTES = 8_000;

/** Over-fetch before relevance scoping, so filtering does not starve the bucket. */
const PREVIOUS_PR_FETCH_MULTIPLIER = 4;

const CITATION_PREFIX: Record<ContextBucket, string> = {
  "agent-sessions": "A",
  codebase: "C",
  "previous-prs": "P",
  docs: "D",
};

type MemoEntry = {
  expiresAt: number;
  value: ReviewContextBrokerResult;
};

const memo = new Map<string, MemoEntry>();
const MEMO_TTL_MS = 45_000;

export type RetrieveReviewContextArgs = {
  orgId: string;
  repoFullName: string;
  queryTerms: {
    intent?: string;
    changedFiles?: string[];
    symbols?: string[];
    branch?: string;
    baseBranch?: string;
    headSha?: string;
    changeCommits?: string[];
  };
  limits?: {
    perBucket?: number;
    snippetChars?: number;
    totalChars?: number;
  };
  /** When true, skip feature flag (tests). */
  force?: boolean;
};

function emptyResult(): ReviewContextBrokerResult {
  const buckets = {
    "agent-sessions": [],
    codebase: [],
    "previous-prs": [],
    docs: [],
  } as Record<ContextBucket, ContextSnippet[]>;
  const manifest = {
    "agent-sessions": { provided: 0, chars: 0 },
    codebase: { provided: 0, chars: 0 },
    "previous-prs": { provided: 0, chars: 0 },
    docs: { provided: 0, chars: 0 },
  } as Record<ContextBucket, ContextManifestEntry>;
  return { buckets, manifest, reviewMdPresent: false };
}

function buildQueryText(args: RetrieveReviewContextArgs): string {
  const parts = [
    args.queryTerms.intent,
    args.queryTerms.branch,
    args.repoFullName,
    ...(args.queryTerms.changedFiles ?? []),
    ...(args.queryTerms.symbols ?? []),
  ].filter(Boolean);
  return parts.join(" ").trim() || args.repoFullName;
}

function memoKey(args: RetrieveReviewContextArgs, query: string): string {
  const hash = createHash("sha256")
    .update(
      [
        args.orgId,
        args.repoFullName,
        query,
        args.queryTerms.headSha ?? "",
        // Part of the key because they change which prior-PR rows are served
        // without changing the query text: two callers that agree on the query
        // but disagree on what counts as the change's own work must not share
        // a cached answer.
        args.queryTerms.baseBranch ?? "",
        (args.queryTerms.changeCommits ?? []).join(","),
        String(args.limits?.perBucket ?? DEFAULT_PER_BUCKET),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
  return hash;
}

const TRUNCATION_MARKER = "\n[truncated]\n";
const TRUNCATION_MARKER_CHARS = TRUNCATION_MARKER.length;

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - TRUNCATION_MARKER_CHARS))}${TRUNCATION_MARKER}`;
}

/**
 * Turn rows into citable snippets, at most `limit` of them.
 *
 * The cap lives here rather than in searchIndex because a fused RRF query
 * answers with one leg per rank_by and TurboPuffer applies `limit` per leg: a
 * three-leg search returns up to three times what the caller asked for. On the
 * live satoricorp/gx namespace a previous-prs query with limit 8 came back with
 * 13 rows and every one was served. searchIndex has a second caller
 * (searchCodeReviewHistory) that post-filters by source kind in JavaScript and
 * structurally depends on that over-return, so capping there would starve
 * GET /v1/review-history instead.
 */
function toSnippets(
  bucket: ContextBucket,
  rows: IndexSearchResult[],
  snippetChars: number,
  limit: number,
): ContextSnippet[] {
  const prefix = CITATION_PREFIX[bucket];
  return rows.slice(0, limit).map((row, index) => {
    const sourceKind =
      typeof row.attributes.source_kind === "string"
        ? row.attributes.source_kind
        : "unknown";
    const file = rowFile(row) || undefined;
    return {
      id: row.id || `${bucket}-${index}`,
      citationId: `${prefix}${index + 1}`,
      bucket,
      sourceKind,
      text: clip(row.text, snippetChars),
      score: row.score,
      file,
      ref: snippetRef(bucket, row),
    };
  });
}

/**
 * The citable identifier for a snippet.
 *
 * Prior-PR rows are indexed with `branch_name` and `head_sha` and no PR number,
 * so `branch@sha` is the most specific true reference available. Handing the
 * model a real one matters: the citation labels are P1, P2, … and the prompt
 * used to ask for `PR #N`, so the model rendered snippet P1 as "PR #1" and the
 * link enricher resolved that to github.com/<repo>/pull/1 — a real, unrelated
 * pull request that was never in the context.
 */
function snippetRef(bucket: ContextBucket, row: IndexSearchResult): string | undefined {
  if (bucket !== "previous-prs") return undefined;
  const branch = rowAttr(row, "branch_name");
  const sha = rowAttr(row, "head_sha").slice(0, 8);
  if (branch && sha) return `${branch}@${sha}`;
  return branch || sha || undefined;
}

function normalizePath(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

function rowFile(row: IndexSearchResult): string {
  return (
    normalizePath(row.attributes.file) || normalizePath(row.attributes.file_path)
  );
}

function rowAttr(row: IndexSearchResult, key: string): string {
  const value = row.attributes[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Branch names that name a shared trunk rather than one change's own branch.
 *
 * Used only as a fallback when the base branch is genuinely unknown — see
 * isTopicBranch. Everywhere the base branch is recorded (bookmarks carry
 * `app_base_branch`, publish bundles carry `base_branch_name`) it is used
 * instead, and this list is never consulted.
 */
const TRUNK_BRANCH_NAMES = new Set([
  "main",
  "master",
  "trunk",
  "develop",
  "development",
  "default",
]);

/**
 * Whether consecutive publishes on `branch` are the same change or different
 * ones.
 *
 * On a topic branch they are the same change: push, amend, push again, and
 * every publish is another revision of one pull request. On a trunk they are
 * not: each publish is its own change, and the earlier ones are exactly the
 * prior history this bucket exists to serve.
 *
 * Getting this wrong in the "everything is a topic branch" direction is what
 * made the first cut of this rule wrong. Comparing branch strings alone
 * excluded every row whose `branch_name` equalled the branch under review, and
 * in the live satoricorp/gx namespace 23 of the 25 prior-PR rows carry
 * `branch_name = "main"` — so a repository whose changes are pushed straight
 * from its default branch (which is this project's own workflow) lost 100% of
 * its prior-PR history no matter how well the files overlapped.
 *
 * When the base branch is unknown an unrecognised name is treated as a topic
 * branch, because the cost of the two mistakes is not symmetric: mistaking a
 * trunk for a topic branch loses history, while mistaking a topic branch for a
 * trunk serves the change its own earlier diff back as a "previous PR" — the
 * fabricated citation this whole path exists to prevent.
 */
function isTopicBranch(branch: string, baseBranch: string): boolean {
  if (!branch) return false;
  if (baseBranch) return branch !== baseBranch;
  return !TRUNK_BRANCH_NAMES.has(branch.toLowerCase());
}

/**
 * Path-ish tokens in free text. The class deliberately keeps `/`, `.`, `-` and
 * `_` so a repo-relative path survives tokenization whole, and excludes
 * everything else so a path can only match at a real boundary — `vendor/a/b.ts`
 * never matches the changed file `a/b.ts`.
 */
const PATH_TOKEN_SPLIT = /[^A-Za-z0-9_./\\+-]+/;

/**
 * Whether a row with no `file` attribute nonetheless names a changed file in
 * its own text.
 *
 * `code_review_summary` chunks are written with `file: ""` unconditionally
 * (see buildCodeReviewHistoryChunks), and so are `code_review_history` findings
 * that carry no path. A file-overlap rule applied to the `file` attribute alone
 * would drop every one of them, for every PR, forever — silently deleting a
 * declared source kind rather than filtering it.
 *
 * An exact repo-relative path appearing verbatim in a prior review's text is a
 * structural anchor, not a tuned threshold: there is no cutoff to calibrate, a
 * path either occurs or it does not, and the answer does not move with how the
 * query happened to be composed.
 */
function textNamesChangedFile(
  row: IndexSearchResult,
  changed: Set<string>,
): boolean {
  const text =
    (typeof row.attributes.text === "string" ? row.attributes.text : "") ||
    row.text;
  if (!text) return false;
  for (const token of text.split(PATH_TOKEN_SPLIT)) {
    if (!token) continue;
    const path = normalizePath(token).replace(/[.,;:]+$/, "");
    if (path && changed.has(path)) return true;
  }
  return false;
}

/**
 * Decide which prior-PR rows may be served for the change under review.
 *
 * Two rules, both hard:
 *
 * 1. The change under review is not one of its own previous PRs. Its published
 *    diff is indexed under its own head SHA and branch, and being the nearest
 *    neighbour of its own query it otherwise takes the top slots of this
 *    bucket. Identity is tested against the change's commits (its head plus
 *    every revision in the bundle) and, on a topic branch only, against the
 *    branch — an amended re-push publishes a different head SHA for the same
 *    pull request, and only the branch ties the two together.
 * 2. A prior-PR row must concern a file the change under review also touches:
 *    its `file` attribute is one of them, or — for the source kinds indexed
 *    without a file — its text names one verbatim.
 *
 * Rule 2 is file overlap rather than a similarity threshold because the scores
 * do not separate the two populations. Measured against the live satoricorp/gx
 * namespace for PR #112 (`internal/cli/doctor.go`,
 * `internal/cli/doctor_code_index_test.go`), the identical indexed row scored
 * cosine distance 0.2895 when the query carried the changed-file list and
 * 0.4782 when it did not — while the nearest genuinely unrelated row (a
 * codereview-judge diff) scored 0.4726. Relevant and irrelevant bands overlap
 * depending only on how the query happened to be composed, so no fixed cutoff
 * separates them. File overlap does not move with the query.
 *
 * When the changed-file list is unknown, relevance cannot be established and
 * the bucket serves nothing. That is the intended outcome: a summary that omits
 * a bullet costs the reader nothing, and one that cites an unrelated PR costs
 * them trust in every other bullet.
 */
export function scopePreviousPrRows(
  rows: IndexSearchResult[],
  args: {
    changedFiles?: string[];
    headSha?: string;
    branch?: string;
    /** Branch the change merges into; decides whether `branch` is a trunk. */
    baseBranch?: string;
    /** Commit ids that belong to the change under review, beyond its head. */
    changeCommits?: string[];
  },
): IndexSearchResult[] {
  const changed = new Set(
    (args.changedFiles ?? []).map(normalizePath).filter(Boolean),
  );
  if (changed.size === 0) return [];

  const ownCommits = [args.headSha, ...(args.changeCommits ?? [])]
    .map((commit) => (commit ?? "").trim().toLowerCase())
    .filter(Boolean);
  const branch = (args.branch ?? "").trim();
  const baseBranch = (args.baseBranch ?? "").trim();
  const ownBranch = isTopicBranch(branch, baseBranch) ? branch : "";

  const seen = new Set<string>();
  const kept: IndexSearchResult[] = [];

  for (const row of rows) {
    const rowSha = rowAttr(row, "head_sha").toLowerCase();
    if (rowSha && ownCommits.some((commit) => sameCommit(rowSha, commit))) {
      continue;
    }
    if (ownBranch && rowAttr(row, "branch_name") === ownBranch) continue;

    const file = rowFile(row);
    if (file) {
      if (!changed.has(file)) continue;
    } else if (!textNamesChangedFile(row, changed)) {
      continue;
    }

    // A revision's diff is indexed one chunk per file part, and an oversized
    // file is windowed into several parts, so one file from one change can
    // match repeatedly; keep the best-ranked. Review rows are one chunk per
    // finding, where two rows naming the same file are two different findings,
    // so they deduplicate on their own id — collapsing those on file would
    // drop a whole source kind whenever a revision diff matched the same path.
    const kind = rowAttr(row, "source_kind");
    const key =
      kind === "published_revision_diff" ? `${kind}:${rowSha}:${file}` : row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }

  return kept;
}

/** Commit ids may be stored full-length or abbreviated; compare on the shorter. */
function sameCommit(a: string, b: string): boolean {
  if (!a || !b) return false;
  const length = Math.min(a.length, b.length);
  return length >= 7 && a.slice(0, length) === b.slice(0, length);
}

async function safeBucketSearch(
  run: () => Promise<IndexSearchResult[]>,
): Promise<IndexSearchResult[]> {
  try {
    return await run();
  } catch (error) {
    console.warn("context broker bucket query failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function fetchReviewMdText(
  db: postgres.Sql,
  args: {
    orgId: string;
    repoFullName: string;
    headSha?: string;
  },
): Promise<string | null> {
  try {
    const token = await getInstallationTokenForRepo(db, args.repoFullName);
    if (!token) return null;
    const ref = args.headSha?.trim() || "HEAD";
    const url = `https://api.github.com/repos/${args.repoFullName}/contents/REVIEW.md?ref=${encodeURIComponent(ref)}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.raw",
        Authorization: `Bearer ${token}`,
        "User-Agent": "gx-server",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return clip(text, REVIEW_MD_MAX_BYTES);
  } catch (error) {
    console.warn("REVIEW.md fetch failed", {
      repo: args.repoFullName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function retrieveReviewContext(
  db: postgres.Sql,
  args: RetrieveReviewContextArgs,
): Promise<ReviewContextBrokerResult> {
  if (!args.force && !contextBrokerEnabled()) {
    return emptyResult();
  }

  const query = buildQueryText(args);
  const key = memoKey(args, query);
  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const perBucket = args.limits?.perBucket ?? DEFAULT_PER_BUCKET;
  const snippetChars = args.limits?.snippetChars ?? DEFAULT_SNIPPET_CHARS;
  const totalChars = args.limits?.totalChars ?? DEFAULT_TOTAL_CHARS;

  const knowledgeNs = reviewKnowledgeNamespace();
  const vector = await embedQueryText(query);

  const [agentRows, codeRows, prRows, policyRows, corpusRows, reviewMd] =
    await Promise.all([
      safeBucketSearch(() =>
        searchIndex({
          orgId: args.orgId,
          repoFullName: args.repoFullName,
          query,
          limit: perBucket,
          sourceKinds: BUCKET_SOURCE_KINDS["agent-sessions"],
          vector: vector ?? undefined,
        }),
      ),
      safeBucketSearch(() =>
        searchIndex({
          orgId: args.orgId,
          repoFullName: args.repoFullName,
          query,
          limit: perBucket,
          sourceKinds: BUCKET_SOURCE_KINDS.codebase,
          vector: vector ?? undefined,
        }),
      ),
      safeBucketSearch(() =>
        searchIndex({
          orgId: args.orgId,
          repoFullName: args.repoFullName,
          query,
          limit: perBucket * PREVIOUS_PR_FETCH_MULTIPLIER,
          sourceKinds: BUCKET_SOURCE_KINDS["previous-prs"],
          vector: vector ?? undefined,
        }),
      ),
      safeBucketSearch(() =>
        searchIndex({
          orgId: args.orgId,
          repoFullName: args.repoFullName,
          query: "REVIEW.md review policy",
          limit: 2,
          sourceKinds: ["review_policy"],
          // separate short query — allow its own embed if needed
        }),
      ),
      safeBucketSearch(() =>
        searchIndex({
          orgId: args.orgId,
          repoFullName: args.repoFullName,
          query,
          limit: perBucket,
          namespace: knowledgeNs,
          includeOrgFilter: false,
          extraFilters: [["source_kind", "Eq", "review_corpus"]],
          vector: vector ?? undefined,
        }),
      ),
      fetchReviewMdText(db, {
        orgId: args.orgId,
        repoFullName: args.repoFullName,
        headSha: args.queryTerms.headSha,
      }),
    ]);

  const result = emptyResult();
  result.buckets["agent-sessions"] = toSnippets(
    "agent-sessions",
    agentRows,
    snippetChars,
    perBucket,
  );
  result.buckets.codebase = toSnippets(
    "codebase",
    codeRows,
    snippetChars,
    perBucket,
  );
  result.buckets["previous-prs"] = toSnippets(
    "previous-prs",
    scopePreviousPrRows(prRows, {
      changedFiles: args.queryTerms.changedFiles,
      headSha: args.queryTerms.headSha,
      branch: args.queryTerms.branch,
      baseBranch: args.queryTerms.baseBranch,
      changeCommits: args.queryTerms.changeCommits,
    }),
    snippetChars,
    perBucket,
  );

  const docs: ContextSnippet[] = [];
  if (reviewMd) {
    docs.push({
      id: "review-md",
      citationId: "D1",
      bucket: "docs",
      sourceKind: "review_policy",
      text: clip(reviewMd, snippetChars),
      file: "REVIEW.md",
    });
    result.reviewMdPresent = true;
  } else if (policyRows.length > 0) {
    const policySnips = toSnippets("docs", policyRows, snippetChars, perBucket);
    docs.push(...policySnips);
    result.reviewMdPresent = true;
  }

  const corpusStart = docs.length;
  const corpusSnips = toSnippets("docs", corpusRows, snippetChars, perBucket).map(
    (snip, i) => ({
      ...snip,
      citationId: `D${corpusStart + i + 1}`,
    }),
  );
  docs.push(...corpusSnips);
  result.buckets.docs = docs.slice(0, perBucket);

  // History-only label when codebase has no code_file hits
  const hasCodeFile = result.buckets.codebase.some(
    (s) => s.sourceKind === "code_file",
  );
  // Spend the budget in the order the prompt actually presents the buckets, and
  // give each one a reserved floor first. Spending it in `Object.keys` order let
  // whichever bucket happened to be declared first take all of it: with the
  // shipped defaults one full bucket is 8 x 1200 = 9600 of a 10000 budget, so the
  // trailing buckets were zeroed after their rows had been retrieved and scoped,
  // and the prompt then told the model those buckets had supplied nothing.
  const spendOrder: ContextBucket[] = [
    "codebase",
    "previous-prs",
    "docs",
    "agent-sessions",
  ];
  const reserve = Math.floor(totalChars / spendOrder.length);

  const kept: Record<string, ContextSnippet[]> = {};
  const spent: Record<string, number> = {};
  const taken: Record<string, number> = {};
  for (const bucket of spendOrder) {
    kept[bucket] = [];
    spent[bucket] = 0;
    taken[bucket] = 0;
  }

  // Pass 1 funds every bucket up to its reserved floor; pass 2 hands the unspent
  // remainder back out in the same priority order, so a bucket with more to say
  // still gets it once everyone else has had their share.
  let remaining = totalChars;
  for (const pass of [0, 1]) {
    for (const bucket of spendOrder) {
      const cap = pass === 0 ? Math.min(reserve - spent[bucket], remaining) : remaining;
      let allowance = cap;
      if (allowance <= 0) continue;
      const snips = result.buckets[bucket];
      for (let i = taken[bucket]; i < snips.length; i += 1) {
        if (allowance <= 0 || remaining <= 0) break;
        const room = Math.min(snippetChars, allowance, remaining);
        // Below the truncation marker's own length `clip` returns nothing but the
        // marker, which would burn budget on a content-free snippet that still
        // carries a citation id the prompt invites the model to cite.
        if (room < TRUNCATION_MARKER_CHARS + 1) break;
        const text = clip(snips[i].text, room);
        kept[bucket].push({ ...snips[i], text });
        spent[bucket] += text.length;
        allowance -= text.length;
        remaining -= text.length;
        taken[bucket] = i + 1;
      }
    }
  }

  for (const bucket of spendOrder) {
    result.buckets[bucket] = kept[bucket];
    result.manifest[bucket] = {
      provided: kept[bucket].length,
      chars: spent[bucket],
      label:
        bucket === "codebase" && kept[bucket].length > 0 && !hasCodeFile
          ? "codebase (history only)"
          : undefined,
    };
  }

  memo.set(key, { expiresAt: Date.now() + MEMO_TTL_MS, value: result });
  return result;
}

export function clearBrokerMemoForTests(): void {
  memo.clear();
}

export function formatContextManifestLine(
  manifest: Record<ContextBucket, ContextManifestEntry>,
): string {
  return `Context provided: agent-sessions=${manifest["agent-sessions"].provided} codebase=${manifest.codebase.provided} previous-prs=${manifest["previous-prs"].provided} docs=${manifest.docs.provided}`;
}

export function formatBucketPromptSections(
  buckets: Record<ContextBucket, ContextSnippet[]>,
): string[] {
  const sections: string[] = [];
  const order: Array<{ bucket: ContextBucket; title: string }> = [
    { bucket: "codebase", title: "Codebase context" },
    { bucket: "previous-prs", title: "Previous PRs" },
    { bucket: "docs", title: "Independent resources" },
    { bucket: "agent-sessions", title: "Agent sessions (indexed)" },
  ];
  for (const { bucket, title } of order) {
    const snips = buckets[bucket];
    if (snips.length === 0) continue;
    sections.push(`## ${title}`);
    for (const snip of snips) {
      const file = snip.file ? ` ${snip.file}` : "";
      const ref = snip.ref ? ` ref=${snip.ref}` : "";
      sections.push(`[${snip.citationId}] (${snip.sourceKind}${file}${ref})`);
      sections.push(snip.text);
      sections.push("");
    }
  }
  return sections;
}

/** Flatten broker buckets into legacy IndexSnippetRow-shaped objects. */
export function flattenBrokerSnippets(
  result: ReviewContextBrokerResult,
): Array<{
  id: string;
  text: string;
  score?: number;
  sourceKind?: string;
  bucket?: ContextBucket;
  file?: string;
  ref?: string;
}> {
  const out: Array<{
    id: string;
    text: string;
    score?: number;
    sourceKind?: string;
    bucket?: ContextBucket;
    file?: string;
    ref?: string;
  }> = [];
  for (const bucket of Object.keys(result.buckets) as ContextBucket[]) {
    for (const snip of result.buckets[bucket]) {
      out.push({
        id: snip.citationId,
        text: snip.text,
        score: snip.score,
        sourceKind: snip.sourceKind,
        bucket,
        file: snip.file,
        ref: snip.ref,
      });
    }
  }
  return out;
}
