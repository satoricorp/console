import { afterEach, describe, expect, test } from "bun:test";
import {
  brokerMemoSizeForTests,
  clearBrokerMemoForTests,
  formatContextManifestLine,
  retrieveReviewContext,
} from "../src/context/broker";
import {
  resetIndexingFetch,
  setIndexingFetch,
} from "../src/indexing/turbopuffer";

const originalBroker = process.env.GX_CONTEXT_BROKER;
const originalOpenAI = process.env.OPENAI_API_KEY;
const originalTpuf = process.env.TURBOPUFFER_API_KEY;

// File-scoped on purpose: every describe below installs an indexing fetch
// override and flips env. When this hook lived inside the first describe, the
// "broker memo bounds" block leaked its override into whatever test file Bun
// ran next — github-webhook.test.ts spied on globalThis.fetch and never saw
// the indexer's calls, so its index-job assertions timed out at 5s.
afterEach(() => {
  clearBrokerMemoForTests();
  resetIndexingFetch();
  if (originalBroker === undefined) delete process.env.GX_CONTEXT_BROKER;
  else process.env.GX_CONTEXT_BROKER = originalBroker;
  if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAI;
  if (originalTpuf === undefined) delete process.env.TURBOPUFFER_API_KEY;
  else process.env.TURBOPUFFER_API_KEY = originalTpuf;
});

describe("retrieveReviewContext broker", () => {
  test("returns empty when flag off", async () => {
    delete process.env.GX_CONTEXT_BROKER;
    const result = await retrieveReviewContext({} as never, {
      orgId: "org-a",
      repoFullName: "acme/app",
      queryTerms: { intent: "auth" },
    });
    expect(result.manifest.codebase.provided).toBe(0);
    expect(formatContextManifestLine(result.manifest)).toContain("codebase=0");
  });

  test("routes source_kinds into buckets and records manifest", async () => {
    process.env.GX_CONTEXT_BROKER = "1";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";

    const bodies: unknown[] = [];
    setIndexingFetch(
      (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: Array.from({ length: 512 }, () => 0.01) }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/query")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        bodies.push(body);
        const kinds: string[] = [];
        const walk = (node: unknown) => {
          if (!Array.isArray(node)) return;
          if (node[0] === "source_kind" && node[1] === "Eq" && typeof node[2] === "string") {
            kinds.push(node[2]);
          }
          for (const child of node) walk(child);
        };
        walk(body.filters);
        const kind = kinds[0] ?? "code_file";
        return new Response(
          JSON.stringify({
            rows: [
              {
                id: `row-${kind}`,
                $dist: 0.1,
                attributes: {
                  text: `snippet for ${kind}`,
                  source_kind: kind,
                  file: kind === "review_policy" ? "REVIEW.md" : "a.ts",
                  org_id: "org-a",
                  repo_full_name: "acme/app",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
    );

    // Avoid GitHub Contents call
    const db = {
      // unused — fetchReviewMd will fail open without installation
    } as never;

    const result = await retrieveReviewContext(db, {
      orgId: "org-a",
      repoFullName: "acme/app",
      queryTerms: { intent: "auth changes", changedFiles: ["a.ts"] },
      force: true,
    });

    expect(bodies.length).toBeGreaterThan(0);
    const hasOrgFilter = bodies.some((b) => {
      const s = JSON.stringify(b);
      return s.includes('"org_id"') && s.includes("org-a");
    });
    expect(hasOrgFilter).toBe(true);

    expect(result.buckets.codebase.length + result.buckets["agent-sessions"].length).toBeGreaterThan(0);
    expect(result.manifest.codebase.provided + result.manifest["agent-sessions"].provided).toBeGreaterThan(0);
  });

  test("previous-prs stays empty when no prior PR touched the changed files", async () => {
    process.env.GX_CONTEXT_BROKER = "1";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";

    // What the live satoricorp/gx namespace returns for PR #112: the PR's own
    // diff, plus an unrelated codereview-judge change.
    const priorRows = [
      {
        id: "self-1",
        $dist: 0.03,
        attributes: {
          text: "gx published revision diff.\nBranch: demo/index-freshness-check",
          source_kind: "published_revision_diff",
          file: "internal/cli/doctor.go",
          branch_name: "demo/index-freshness-check",
          head_sha: "35c8e6a869fdd6f59a774ca3e58c411d5ed7dec4",
        },
      },
      {
        id: "judge-1",
        $dist: 0.02,
        attributes: {
          text: "gx published revision diff.\nDescription: Make the judge verify every candidate",
          source_kind: "published_revision_diff",
          file: "internal/codereview/judge.go",
          branch_name: "main",
          head_sha: "a001eaac1f0b0d5f0e6c9a2b3c4d5e6f70819293",
        },
      },
    ];

    setIndexingFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/query")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const kinds: string[] = [];
        const walk = (node: unknown) => {
          if (!Array.isArray(node)) return;
          if (node[0] === "source_kind" && node[1] === "Eq" && typeof node[2] === "string") {
            kinds.push(node[2]);
          }
          for (const child of node) walk(child);
        };
        walk(body.filters ?? body.queries?.[0]?.filters);
        if (kinds.includes("published_revision_diff")) {
          return new Response(JSON.stringify({ rows: priorRows }), { status: 200 });
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch);

    const result = await retrieveReviewContext({} as never, {
      orgId: "org-a",
      repoFullName: "satoricorp/gx",
      queryTerms: {
        changedFiles: [
          "internal/cli/doctor.go",
          "internal/cli/doctor_code_index_test.go",
        ],
        branch: "demo/index-freshness-check",
        headSha: "35c8e6a869fdd6f59a774ca3e58c411d5ed7dec4",
      },
      force: true,
    });

    expect(result.buckets["previous-prs"]).toEqual([]);
    expect(result.manifest["previous-prs"].provided).toBe(0);
    expect(formatContextManifestLine(result.manifest)).toContain(
      "previous-prs=0",
    );
  });

  test("caps a bucket at perBucket when the fused query over-returns", async () => {
    // TurboPuffer applies `limit` per rank_by leg, so a three-leg RRF search
    // answers with up to three times the requested count. searchIndex passes
    // that through (searchCodeReviewHistory depends on it), so the cap has to
    // hold here — a live previous-prs query with limit 8 served 13 rows.
    process.env.GX_CONTEXT_BROKER = "1";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";

    setIndexingFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          rows: Array.from({ length: 13 }, (_, i) => ({
            id: `code-${i}`,
            $dist: 0.03,
            attributes: {
              text: `code body ${i}`,
              source_kind: "code_file",
              file: `src/file-${i}.ts`,
            },
          })),
        }),
        { status: 200 },
      );
    }) as typeof fetch);

    const result = await retrieveReviewContext({} as never, {
      orgId: "org-a",
      repoFullName: "acme/app",
      queryTerms: { intent: "retry backoff" },
      limits: { perBucket: 8 },
      force: true,
    });

    expect(result.buckets.codebase).toHaveLength(8);
    expect(result.manifest.codebase.provided).toBe(8);
  });

  test("memoizes identical queries within TTL", async () => {
    process.env.GX_CONTEXT_BROKER = "1";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    let embedCalls = 0;
    setIndexingFetch(
      (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        embedCalls += 1;
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: Array.from({ length: 512 }, () => 0.02) }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }) as typeof fetch,
    );

    const args = {
      orgId: "org-a",
      repoFullName: "acme/app",
      queryTerms: { intent: "memo" },
      force: true,
    } as const;
    await retrieveReviewContext({} as never, args);
    const afterFirst = embedCalls;
    expect(afterFirst).toBeGreaterThan(0);
    await retrieveReviewContext({} as never, args);
    expect(embedCalls).toBe(afterFirst);
  });

  test("every bucket keeps a share of the budget when all are full", async () => {
    process.env.GX_CONTEXT_BROKER = "1";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";

    // Long rows in every bucket. Before the budget was spent in prompt-priority
    // order with a per-bucket floor, one bucket took 8 x 1200 = 9600 of the
    // 10000-char budget and the rest were zeroed after being retrieved.
    const long = "x".repeat(4000);
    setIndexingFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/query")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const kinds: string[] = [];
        const walk = (node: unknown) => {
          if (!Array.isArray(node)) return;
          if (node[0] === "source_kind" && node[1] === "Eq" && typeof node[2] === "string") {
            kinds.push(node[2]);
          }
          for (const child of node) walk(child);
        };
        walk(body.filters);
        const kind = kinds[0] ?? "code_file";
        return new Response(
          JSON.stringify({
            rows: Array.from({ length: 8 }, (_, i) => ({
              id: `${kind}-${i}`,
              $dist: 0.1,
              attributes: {
                text: long,
                source_kind: kind,
                file: "a.ts",
                org_id: "org-a",
                repo_full_name: "acme/app",
                // A genuinely earlier branch: same-branch rows are correctly
                // dropped as the change's own work, which would mask the budget bug.
                branch_name: "older-feature",
                head_sha: "older-sha",
              },
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch);

    const result = await retrieveReviewContext({} as never, {
      orgId: "org-a",
      repoFullName: "acme/app",
      queryTerms: {
        intent: "auth changes",
        changedFiles: ["a.ts"],
        branch: "feature",
        baseBranch: "main",
      },
      force: true,
    });

    // The load-bearing assertion: no bucket that retrieved rows is starved to zero.
    expect(result.manifest.codebase.provided).toBeGreaterThan(0);
    expect(result.manifest["previous-prs"].provided).toBeGreaterThan(0);

    const total = Object.values(result.manifest).reduce((sum, m) => sum + m.chars, 0);
    expect(total).toBeLessThanOrEqual(10_000);

    // No snippet may be nothing but the truncation marker: it would carry a live
    // citation id the prompt invites the model to cite, with no content behind it.
    for (const snips of Object.values(result.buckets)) {
      for (const snip of snips) {
        expect(snip.text.replace("\n[truncated]\n", "").length).toBeGreaterThan(0);
      }
    }
  });
});
describe("broker memo bounds", () => {
  test("expired entries are removed, not merely skipped", async () => {
    process.env.GX_CONTEXT_BROKER = "1";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    setIndexingFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        return new Response(
          JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ rows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);

    // Every push mints a fresh key, so nothing is reclaimed by overwrite. The
    // TTL only decided whether a hit was served — an expired entry stayed
    // resident for the life of the process.
    for (let i = 0; i < 300; i += 1) {
      await retrieveReviewContext({} as never, {
        orgId: "org-a",
        repoFullName: "acme/app",
        queryTerms: { intent: `change ${i}`, headSha: `sha-${i}` },
        force: true,
      });
    }
    expect(brokerMemoSizeForTests()).toBeLessThanOrEqual(256);
  });
});
