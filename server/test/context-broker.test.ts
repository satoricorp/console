import { afterEach, describe, expect, test } from "bun:test";
import {
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

describe("retrieveReviewContext broker", () => {
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
});