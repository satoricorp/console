import { describe, expect, mock, test } from "bun:test";
import { BUCKET_SOURCE_KINDS, scopePreviousPrRows } from "../src/context/broker";
import {
  embeddingDimensions,
} from "../src/indexing/config";
import { type IndexSearchResult } from "../src/indexing/search";
import {
  indexCodeReviewHistory,
  indexPublishedArtifact,
  resetIndexingFetch,
  setIndexingFetch,
} from "../src/indexing/turbopuffer";

/**
 * Rows shaped like the live satoricorp/tx namespace, which is what
 * `published_revision_diff` chunks actually look like: a branch, a head SHA, a
 * per-file part of the revision's patch, and no PR number anywhere.
 */
function row(
  file: string,
  headSha: string,
  branch: string,
  description: string,
): IndexSearchResult {
  const text = [
    "TX published revision diff.",
    "Repo: satoricorp/tx",
    `Branch: ${branch}`,
    `Head: ${headSha}`,
    `Description: ${description}`,
    `Files:\n${file}`,
  ].join("\n");
  return {
    id: `tx-published-revision-${headSha}-${file}`,
    score: 0.5,
    text,
    attributes: {
      text,
      file,
      file_path: file,
      branch_name: branch,
      head_sha: headSha,
      source_kind: "published_revision_diff",
      repo_full_name: "satoricorp/tx",
    },
  };
}

/**
 * A `code_review_summary` chunk. buildCodeReviewHistoryChunks writes these with
 * `file: ""` unconditionally, so the only place the run's subject appears is
 * inside the text.
 */
function reviewSummaryRow(mentionedFile: string): IndexSearchResult {
  const text = [
    "TX code review summary.",
    "Repo: satoricorp/tx",
    "Branch: main",
    `Head: ${"a001eaac1f0b0d5f0e6c9a2b3c4d5e6f70819293"}`,
    `Two findings in ${mentionedFile}, both resolved.`,
  ].join("\n");
  return {
    id: "tx-code-review-summary-1",
    score: 0.4,
    text,
    attributes: {
      text,
      file: "",
      source_kind: "code_review_summary",
      branch_name: "main",
      head_sha: "a001eaac1f0b0d5f0e6c9a2b3c4d5e6f70819293",
      repo_full_name: "satoricorp/tx",
    },
  };
}

// The exact population the live index returned for PR #112's broker query.
const PR_112_HEAD = "35c8e6a869fdd6f59a774ca3e58c411d5ed7dec4";
const PR_112_BRANCH = "demo/index-freshness-check";
const PR_112_FILES = [
  "internal/cli/doctor.go",
  "internal/cli/doctor_code_index_test.go",
];
const JUDGE_HEAD = "a001eaac1f0b0d5f0e6c9a2b3c4d5e6f70819293";
const JUDGE_TITLE = "Make the judge verify every candidate, and let it reason";

const liveRows: IndexSearchResult[] = [
  row(PR_112_FILES[1]!, PR_112_HEAD, PR_112_BRANCH, "Report code index drift in tx doctor"),
  row(PR_112_FILES[0]!, PR_112_HEAD, PR_112_BRANCH, "Report code index drift in tx doctor"),
  row("internal/codereview/engine_callers_test.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/testdata/judge-prose-preamble.txt", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/judge.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/judge_live_test.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/judge_parse_test.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/bedrock_transport.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/dedupe_ai.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/ai.go", JUDGE_HEAD, "main", JUDGE_TITLE),
  row("internal/codereview/engine.go", JUDGE_HEAD, "main", JUDGE_TITLE),
];

describe("scopePreviousPrRows", () => {
  test("serves nothing for satoricorp/tx#112 — no prior PR touched its files", () => {
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: PR_112_FILES,
      headSha: PR_112_HEAD,
      branch: PR_112_BRANCH,
    });
    expect(kept).toEqual([]);
  });

  test("drops an unrelated prior PR that shares no file", () => {
    // The judge change is the only other change in the namespace and it touches
    // internal/codereview/*. It produced the "medical checks" and "logging
    // mechanism for empty index states" bullets on a PR that only edited
    // internal/cli/doctor.go.
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: ["internal/cli/doctor.go"],
      headSha: PR_112_HEAD,
      branch: PR_112_BRANCH,
    });
    expect(kept.map((r) => r.attributes.file)).not.toContain(
      "internal/codereview/judge.go",
    );
    expect(kept).toEqual([]);
  });

  test("excludes the PR under review from its own previous-PRs bucket", () => {
    // Same files, but pretend the head SHA is unknown to prove branch alone
    // also disqualifies, and vice versa.
    const byBranch = scopePreviousPrRows(liveRows, {
      changedFiles: PR_112_FILES,
      branch: PR_112_BRANCH,
    });
    expect(byBranch).toEqual([]);

    const bySha = scopePreviousPrRows(liveRows, {
      changedFiles: PR_112_FILES,
      headSha: PR_112_HEAD,
    });
    expect(bySha).toEqual([]);
  });

  test("matches an abbreviated head SHA against a full one", () => {
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: PR_112_FILES,
      headSha: "35c8e6a8",
    });
    expect(kept).toEqual([]);
  });

  test("serves a prior PR that did touch the same file", () => {
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: ["internal/codereview/judge.go"],
      headSha: "ffffffffffffffffffffffffffffffffffffffff",
      branch: "feat/judge-tweak",
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.attributes.file).toBe("internal/codereview/judge.go");
    expect(kept[0]!.attributes.head_sha).toBe(JUDGE_HEAD);
  });

  test("serves nothing when the changed-file list is unknown", () => {
    // Relevance cannot be established without knowing what the PR touched, and
    // an empty bucket is preferable to an arbitrary one.
    expect(
      scopePreviousPrRows(liveRows, { headSha: PR_112_HEAD, branch: PR_112_BRANCH }),
    ).toEqual([]);
    expect(
      scopePreviousPrRows(liveRows, { changedFiles: [], headSha: PR_112_HEAD }),
    ).toEqual([]);
  });

  test("collapses repeated parts of one file from one change", () => {
    const duplicated = [
      row("internal/codereview/judge.go", JUDGE_HEAD, "main", JUDGE_TITLE),
      row("internal/codereview/judge.go", JUDGE_HEAD, "main", JUDGE_TITLE),
      row("internal/codereview/judge.go", JUDGE_HEAD, "main", JUDGE_TITLE),
    ];
    const kept = scopePreviousPrRows(duplicated, {
      changedFiles: ["internal/codereview/judge.go"],
      headSha: "ffffffff",
      branch: "feat/x",
    });
    expect(kept).toHaveLength(1);
  });

  test("normalizes ./ and leading-slash paths on both sides", () => {
    const kept = scopePreviousPrRows(
      [row("./internal/codereview/judge.go", JUDGE_HEAD, "main", JUDGE_TITLE)],
      {
        changedFiles: ["/internal/codereview/judge.go"],
        headSha: "ffffffff",
        branch: "feat/x",
      },
    );
    expect(kept).toHaveLength(1);
  });

  test("drops a file-less row whose text names none of the changed files", () => {
    expect(
      scopePreviousPrRows([reviewSummaryRow("internal/codereview/judge.go")], {
        changedFiles: ["internal/cli/doctor.go"],
        headSha: PR_112_HEAD,
        branch: PR_112_BRANCH,
      }),
    ).toEqual([]);
  });

  test("serves a file-less review summary that names a changed file verbatim", () => {
    // `code_review_summary` chunks are indexed with `file: ""`, so a rule that
    // only reads the file attribute would delete the source kind outright
    // rather than filter it — prior review conclusions could never reach the
    // bucket again for any PR.
    const kept = scopePreviousPrRows(
      [reviewSummaryRow("internal/cli/doctor.go")],
      {
        changedFiles: ["internal/cli/doctor.go"],
        headSha: PR_112_HEAD,
        branch: PR_112_BRANCH,
      },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.attributes.source_kind).toBe("code_review_summary");
  });

  test("a file-less row only matches a path at a real boundary", () => {
    // `vendor/internal/cli/doctor.go` is a different file; a substring test
    // would serve a review of it as though it concerned the changed one.
    expect(
      scopePreviousPrRows(
        [reviewSummaryRow("vendor/internal/cli/doctor.go")],
        {
          changedFiles: ["internal/cli/doctor.go"],
          headSha: PR_112_HEAD,
          branch: PR_112_BRANCH,
        },
      ),
    ).toEqual([]);
  });
});

describe("scopePreviousPrRows: which branch is the change's own", () => {
  // 23 of the 25 prior-PR rows in the live satoricorp/tx namespace carry
  // branch_name = "main". A rule that excluded every row sharing the branch
  // string erased all of them for any change pushed from the default branch —
  // which is this project's own workflow.
  test("keeps trunk history when the change is pushed from the base branch", () => {
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: ["internal/codereview/judge.go"],
      headSha: "ffffffffffffffffffffffffffffffffffffffff",
      branch: "main",
      baseBranch: "main",
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.attributes.head_sha).toBe(JUDGE_HEAD);
  });

  test("keeps trunk history when the base branch is unknown", () => {
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: ["internal/codereview/judge.go"],
      headSha: "ffffffffffffffffffffffffffffffffffffffff",
      branch: "main",
    });
    expect(kept).toHaveLength(1);
  });

  test("still excludes a pull request's own branch when it is not the base", () => {
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: PR_112_FILES,
      headSha: "ffffffffffffffffffffffffffffffffffffffff",
      branch: PR_112_BRANCH,
      baseBranch: "main",
    });
    expect(kept).toEqual([]);
  });

  test("excludes an earlier publish of the same change by its commit id", () => {
    // The tx review path knows the range's commits but may not know the
    // branch. A re-push publishes a new head SHA, so head-SHA equality alone
    // would serve the change its own earlier diff back as a "previous PR".
    const kept = scopePreviousPrRows(liveRows, {
      changedFiles: PR_112_FILES,
      headSha: "1111111111111111111111111111111111111111",
      changeCommits: [PR_112_HEAD],
    });
    expect(kept).toEqual([]);
  });
});

/**
 * The bucket declares three source kinds; the indexer decides what attributes
 * their rows carry. Nothing else ties the two together, so a relevance rule can
 * silently delete a whole declared source kind — as an earlier file-attribute
 * rule did to `code_review_summary`, whose chunks are all written with
 * `file: ""`. Index each kind for real and prove a row of it can still be
 * served.
 */
describe("every declared previous-prs source kind can still be served", () => {
  function captureUpserts(rows: Array<Record<string, unknown>>) {
    setIndexingFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
        if (url.includes("/embeddings")) {
          const inputs = (body as { input: string[] }).input;
          return Response.json({
            data: inputs.map((_, index) => ({
              index,
              embedding: Array.from({ length: embeddingDimensions }, () => 0.01),
            })),
          });
        }
        for (const row of body?.upsert_rows ?? []) rows.push(row);
        return Response.json({ status: "OK" });
      }) as unknown as typeof fetch,
    );
  }

  function asSearchResults(
    rows: Array<Record<string, unknown>>,
  ): IndexSearchResult[] {
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      score: 0.1,
      text: String(row.text ?? ""),
      attributes: row,
    }));
  }

  test("published_revision_diff, code_review_summary and code_review_history all survive", async () => {
    expect(BUCKET_SOURCE_KINDS["previous-prs"]).toEqual([
      "published_revision_diff",
      "code_review_summary",
      "code_review_history",
    ]);

    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const rows: Array<Record<string, unknown>> = [];
    captureUpserts(rows);

    await indexPublishedArtifact({
      orgId: "org-1",
      repoFullName: "acme/app",
      eventId: "event-1",
      branchName: "main",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      payload: {
        revisions: [
          {
            description: "tighten the retry guard",
            files: ["src/retry.ts"],
            patch: "diff --git a/src/retry.ts b/src/retry.ts\n@@ -1 +1 @@\n+x\n",
          },
        ],
      } as never,
    });

    await indexCodeReviewHistory({
      orgId: "org-1",
      repoFullName: "acme/app",
      runId: "run-1",
      summaryId: "sum-1",
      branchName: "main",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      summaryText: "One unresolved finding remains in src/retry.ts.",
      findings: [
        {
          id: "f-1",
          fingerprint: "fp-1",
          outcome: "accepted",
          category: "correctness",
          filePath: "src/retry.ts",
          title: "Retry loop never backs off",
          summary: "The delay is recomputed but never applied.",
        },
      ],
    });

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;

    const indexedKinds = new Set(rows.map((row) => String(row.source_kind)));
    for (const kind of BUCKET_SOURCE_KINDS["previous-prs"]) {
      expect(indexedKinds.has(kind)).toBe(true);
    }

    // A later change touching the same file: different head, different branch.
    const served = scopePreviousPrRows(asSearchResults(rows), {
      changedFiles: ["src/retry.ts"],
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      branch: "fix/retry-backoff",
      baseBranch: "main",
    });
    const servedKinds = new Set(
      served.map((row) => String(row.attributes.source_kind)),
    );
    for (const kind of BUCKET_SOURCE_KINDS["previous-prs"]) {
      expect(servedKinds.has(kind)).toBe(true);
    }
  });
});
