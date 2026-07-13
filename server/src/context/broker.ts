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

const BUCKET_SOURCE_KINDS: Record<ContextBucket, string[]> = {
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
    headSha?: string;
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
        String(args.limits?.perBucket ?? DEFAULT_PER_BUCKET),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
  return hash;
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14))}\n[truncated]\n`;
}

function toSnippets(
  bucket: ContextBucket,
  rows: IndexSearchResult[],
  snippetChars: number,
): ContextSnippet[] {
  const prefix = CITATION_PREFIX[bucket];
  return rows.map((row, index) => {
    const sourceKind =
      typeof row.attributes.source_kind === "string"
        ? row.attributes.source_kind
        : "unknown";
    const file =
      typeof row.attributes.file === "string" && row.attributes.file
        ? row.attributes.file
        : undefined;
    return {
      id: row.id || `${bucket}-${index}`,
      citationId: `${prefix}${index + 1}`,
      bucket,
      sourceKind,
      text: clip(row.text, snippetChars),
      score: row.score,
      file,
    };
  });
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
          limit: perBucket,
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
  );
  result.buckets.codebase = toSnippets("codebase", codeRows, snippetChars);
  result.buckets["previous-prs"] = toSnippets(
    "previous-prs",
    prRows,
    snippetChars,
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
    const policySnips = toSnippets("docs", policyRows, snippetChars);
    docs.push(...policySnips);
    result.reviewMdPresent = true;
  }

  const corpusStart = docs.length;
  const corpusSnips = toSnippets("docs", corpusRows, snippetChars).map(
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
  let remaining = totalChars;
  for (const bucket of Object.keys(result.buckets) as ContextBucket[]) {
    const kept: ContextSnippet[] = [];
    let chars = 0;
    for (const snip of result.buckets[bucket]) {
      if (remaining <= 0) break;
      const text = clip(snip.text, Math.min(snippetChars, remaining));
      kept.push({ ...snip, text });
      chars += text.length;
      remaining -= text.length;
    }
    result.buckets[bucket] = kept;
    result.manifest[bucket] = {
      provided: kept.length,
      chars,
      label:
        bucket === "codebase" && kept.length > 0 && !hasCodeFile
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
      sections.push(`[${snip.citationId}] (${snip.sourceKind}${file})`);
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
}> {
  const out: Array<{
    id: string;
    text: string;
    score?: number;
    sourceKind?: string;
    bucket?: ContextBucket;
    file?: string;
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
      });
    }
  }
  return out;
}
