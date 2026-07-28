import { describe, expect, mock, test } from "bun:test";
import {
  embeddingDimensions,
  indexSchemaVersion,
  namespaceForOrgRepo,
  openAIEmbeddingModel,
} from "../src/indexing/config";
import {
  buildSearchBody,
  identifierTerms,
  indexPublishedArtifact,
  resetIndexingFetch,
  searchCodeReviewHistory,
  searchIndex,
  setIndexingFetch,
  splitPatchIntoParts,
} from "../src/indexing/turbopuffer";

function mockIndexingFetch(calls: Array<{ url: string; body: unknown }>) {
  setIndexingFetch(
    mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
      calls.push({ url, body });
      if (url.includes("/embeddings")) {
        const inputs = (body as { input: string[] }).input;
        return Response.json({
          data: inputs.map((_, index) => ({
            index,
            embedding: Array.from({ length: embeddingDimensions }, () => 0.01),
          })),
        });
      }
      if (url.includes("/query")) {
        return Response.json({ rows: [] });
      }
      return Response.json({ status: "OK" });
    }) as unknown as typeof fetch,
  );
}

describe("indexing namespace + schema", () => {
  test("namespace matches the gx CLI shape and carries the schema version", () => {
    expect(namespaceForOrgRepo("2f273110-b6ce-4b3b-95d3-e7c0ca802e83", "satoricorp/gx")).toBe(
      `gx-2f273110-b6ce-4b3b-95d3-e7c0ca802e83-satoricorp-gx-v${indexSchemaVersion}`,
    );
    // A schema change must land in a new namespace: TurboPuffer pins vector
    // width and full-text settings per namespace.
    expect(namespaceForOrgRepo("org", "acme/app")).toEndWith(`-v${indexSchemaVersion}`);
    // Trailing separators must not produce a double dash before the version.
    expect(namespaceForOrgRepo("org", "acme/app/")).toBe(`gx-org-acme-app-v${indexSchemaVersion}`);
  });

  test("embedding model and width are the values the eval selected", () => {
    expect(openAIEmbeddingModel).toBe("text-embedding-3-small");
    expect(embeddingDimensions).toBe(1536);
  });

  test("upsert declares hybrid-search fields and the configured vector width", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const calls: Array<{ url: string; body: any }> = [];
    mockIndexingFetch(calls);

    const result = await indexPublishedArtifact({
      orgId: "org-1",
      repoFullName: "acme/app",
      eventId: "event-1",
      branchName: "main",
      headSha: "abc123",
      payload: {
        revisions: [
          { description: "add thing", files: ["a.ts"], patch: "diff --git a/a.ts b/a.ts\n+x\n" },
        ],
      } as never,
    });
    expect(result.status).toBe("indexed");

    const upsert = calls.find((c) => c.url.includes("turbopuffer.com") && c.body?.schema);
    expect(upsert).toBeDefined();
    const schema = upsert!.body.schema as Record<string, any>;
    expect(schema.vector.type).toBe(`[${embeddingDimensions}]f32`);
    // `text` stemmed so "retry" reaches "retries"; `symbol` unstemmed so
    // identifier lookups stay exact.
    expect(schema.text.full_text_search.stemming).toBe(true);
    expect(schema.symbol.full_text_search.stemming).toBe(false);
    for (const field of ["file_path", "symbol_name", "symbol_kind", "language", "doc_type", "commit_id"]) {
      expect(schema[field]).toEqual({ type: "string", filterable: true });
    }
    expect(schema.start_line).toEqual({ type: "uint", filterable: true });

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });
});

describe("splitPatchIntoParts", () => {
  test("emits one part per file and attributes each to its path", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "@@ -1 +1 @@",
      "-old b",
      "+new b",
    ].join("\n");
    const parts = splitPatchIntoParts(patch, 8_000);
    expect(parts.map((p) => p.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parts[0]!.body).toContain("+new");
    expect(parts[1]!.body).toContain("+new b");
  });

  test("windows a single oversized file diff instead of truncating it", () => {
    const body = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join("\n");
    const patch = `diff --git a/big.ts b/big.ts\n@@ -1 +1 @@\n${body}`;
    const parts = splitPatchIntoParts(patch, 1_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.file).toBe("big.ts");
      expect(Buffer.byteLength(part.body, "utf8")).toBeLessThanOrEqual(1_000);
    }
    // Nothing may be dropped: the last line of the diff must survive.
    expect(parts.at(-1)!.body).toContain("+line 499");
  });

  test("handles a patch with no diff header and an empty patch", () => {
    expect(splitPatchIntoParts("", 1_000)).toEqual([]);
    expect(splitPatchIntoParts("   \n ", 1_000)).toEqual([]);
    const parts = splitPatchIntoParts("@@ -1 +1 @@\n-a\n+b", 1_000);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.file).toBe("");
  });
});

describe("hybrid query construction", () => {
  const vector = [0.1, 0.2];

  test("fuses vector, text and symbol legs with RRF", () => {
    const body = buildSearchBody({
      vector,
      query: "where does DeleteStaleCodeDocuments run",
      limit: 8,
      lexical: true,
    });
    expect(body.rerank_by).toEqual(["RRF"]);
    const legs = body.queries as Array<Record<string, any>>;
    expect(legs).toHaveLength(3);
    expect(legs[0]!.rank_by).toEqual(["vector", "ANN", vector]);
    expect(legs[1]!.rank_by[0]).toBe("text");
    expect(legs[1]!.rank_by[1]).toBe("BM25");
    expect(legs[2]!.rank_by[0]).toBe("symbol");
    for (const leg of legs) {
      expect(leg.limit).toEqual({ total: 8 });
    }
  });

  test("skips the symbol leg when the query names no identifier", () => {
    const body = buildSearchBody({
      vector,
      query: "how are upload failures retried",
      limit: 5,
      lexical: true,
    });
    const legs = body.queries as Array<Record<string, any>>;
    expect(legs).toHaveLength(2);
    expect(legs.some((leg) => leg.rank_by[0] === "symbol")).toBe(false);
  });

  test("falls back to a plain vector query when lexical search is off", () => {
    const body = buildSearchBody({ vector, query: "anything", limit: 5, lexical: false });
    expect(body.rank_by).toEqual(["vector", "ANN", vector]);
    expect(body.queries).toBeUndefined();
  });

  test("propagates filters to every leg", () => {
    const filters = ["And", [["org_id", "Eq", "o"]]];
    const body = buildSearchBody({
      vector,
      query: "runIncrementalIndex",
      limit: 5,
      filters,
      lexical: true,
    });
    for (const leg of body.queries as Array<Record<string, any>>) {
      expect(leg.filters).toEqual(filters);
    }
  });

  test("identifierTerms expands camelCase without losing the verbatim symbol", () => {
    const terms = identifierTerms("why does AttachSessionsFromHunkLinks fail").split(" ");
    expect(terms).toContain("AttachSessionsFromHunkLinks");
    expect(terms).toContain("attach");
    expect(terms).toContain("hunk");
    expect(identifierTerms("GX_REVIEW_JUDGE").split(" ")).toContain("judge");
    // Plain prose must not produce a symbol query.
    expect(identifierTerms("how are upload failures retried")).toBe("");
  });

  test("re-embeds at the target namespace's width instead of sending a mismatched vector", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const embedCalls: any[] = [];
    let queried: any;
    setIndexingFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
        if (url.includes("/embeddings")) {
          embedCalls.push(body);
          return Response.json({
            data: [{ index: 0, embedding: Array.from({ length: body.dimensions }, () => 0.01) }],
          });
        }
        queried = body;
        return Response.json({ rows: [] });
      }) as unknown as typeof fetch,
    );

    // The broker fans one embedding across buckets. The shared knowledge
    // namespace is 512-d; sending it a 1536-d vector is rejected outright and
    // the caller's error handler would silently drop the whole bucket.
    const wideVector = Array.from({ length: embeddingDimensions }, () => 0.01);
    await searchIndex({
      orgId: "org-1",
      repoFullName: "acme/app",
      query: "secure coding guidance",
      namespace: "gx-review-knowledge",
      includeOrgFilter: false,
      vector: wideVector,
    });

    expect(embedCalls).toHaveLength(1);
    expect(embedCalls[0].dimensions).toBe(512);
    expect(queried.rank_by[2]).toHaveLength(512);
    // A foreign namespace has no `symbol` column, so no lexical legs.
    expect(queried.queries).toBeUndefined();

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });

  test("reuses a matching precomputed vector without re-embedding", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const embedCalls: any[] = [];
    setIndexingFetch(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/embeddings")) {
          embedCalls.push(init?.body);
          return Response.json({ data: [{ index: 0, embedding: [] }] });
        }
        return Response.json({ rows: [] });
      }) as unknown as typeof fetch,
    );

    await searchIndex({
      orgId: "org-1",
      repoFullName: "acme/app",
      query: "IndexRepository",
      vector: Array.from({ length: embeddingDimensions }, () => 0.01),
    });
    expect(embedCalls).toHaveLength(0);

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });

  test("searchIndex reads rows from a fused multi-query response", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    setIndexingFetch(
      mock(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/embeddings")) {
          return Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
        }
        return Response.json({
          results: [
            {
              rows: [
                {
                  id: "gxc-1",
                  $dist: 0.2,
                  file_path: "internal/semantic/codeindex.go",
                  text: "chunk body",
                },
              ],
            },
          ],
        });
      }) as unknown as typeof fetch,
    );

    const rows = await searchIndex({
      orgId: "org-1",
      repoFullName: "acme/app",
      query: "IndexRepository",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("chunk body");
    expect(rows[0]!.attributes.file_path).toBe("internal/semantic/codeindex.go");

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });

  /**
   * TurboPuffer applies `limit` per rank_by leg, so an RRF search over three
   * legs answers with up to three times what the caller asked for — a live
   * previous-prs query with limit 8 came back with 13 rows. That over-return is
   * passed through rather than capped here, because searchCodeReviewHistory
   * searches unfiltered and narrows to its own source kinds afterwards: a cap
   * inside searchIndex would starve GET /v1/review-history, not the bucket that
   * over-served. Callers that need a hard cap apply it after their own
   * filtering.
   */
  function mockFusedOverReturn(historyFrom: number, total: number) {
    setIndexingFetch(
      mock(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/embeddings")) {
          return Response.json({
            data: [
              {
                index: 0,
                embedding: Array.from({ length: embeddingDimensions }, () => 0.01),
              },
            ],
          });
        }
        return Response.json({
          rows: Array.from({ length: total }, (_, i) => ({
            id: `row-${i}`,
            $dist: 0.03,
            text: `body ${i}`,
            source_kind: i >= historyFrom ? "code_review_history" : "code_file",
          })),
        });
      }) as unknown as typeof fetch,
    );
  }

  test("passes a fused over-return through to the caller", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    mockFusedOverReturn(8, 13);

    const rows = await searchIndex({
      orgId: "org-1",
      repoFullName: "acme/app",
      query: "doctor code index freshness",
      limit: 8,
    });
    expect(rows).toHaveLength(13);

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });

  test("code-review history survives below the requested limit", async () => {
    // The history rows sit at fused ranks 9–13. searchCodeReviewHistory has no
    // source_kind filter and post-filters in JavaScript, so truncating to the
    // limit first would return nothing at all here.
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    mockFusedOverReturn(8, 13);

    const rows = await searchCodeReviewHistory({
      orgId: "org-1",
      repoFullName: "acme/app",
      query: "retry backoff",
      limit: 8,
    });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.attributes.source_kind).toBe("code_review_history");
    }

    resetIndexingFetch();
    delete process.env.OPENAI_API_KEY;
    delete process.env.TURBOPUFFER_API_KEY;
  });
});

describe("published-revision chunks: a header must not eat the chunk", () => {
  // A bulk rename or codegen drop touches hundreds of paths in one commit. The
  // header inlined every path with no cap, so it grew past the 8000-byte chunk:
  // the patch budget went negative, splitPatchIntoParts clamped it to its
  // floor, and limitBytes then truncated inside the header — every chunk came
  // out byte-identical under a distinct id, the diff was embedded nowhere, and
  // indexPublishedArtifact still returned {status:"indexed"}.
  test("indexes the diff of a commit touching hundreds of files", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.TURBOPUFFER_API_KEY = "test-tpuf";
    const calls: Array<{ url: string; body: any }> = [];
    mockIndexingFetch(calls);

    const files = Array.from({ length: 250 }, (_, i) => `src/very/deeply/nested/module-${i}/index.ts`);
    const patch = files
      .map(
        (f) =>
          `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1,2 +1,2 @@\n-const marker = "old-${f}";\n+const marker = "new-${f}";\n`,
      )
      .join("");

    const result = await indexPublishedArtifact({
      orgId: "org-1",
      repoFullName: "acme/app",
      eventId: "event-big",
      branchName: "main",
      headSha: "abc123",
      payload: { revisions: [{ revision_id: "r1", files, patch, description: "Bulk rename" }] },
    } as never);

    expect(result.status).toBe("indexed");

    const upserts = calls.filter((c) => !c.url.includes("/embeddings"));
    const texts: string[] = upserts.flatMap((c) =>
      (c.body?.upsert_rows ?? c.body?.upserts ?? []).map((r: any) => String(r.text ?? "")),
    );
    expect(texts.length).toBeGreaterThan(0);

    // The load-bearing assertions: real diff content is embedded, and the
    // chunks are not all the same truncated header.
    const withPatch = texts.filter((t) => t.includes("Patch:"));
    expect(withPatch.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBeGreaterThan(1);
    // Marker lines from the actual diff must survive into the index.
    expect(texts.some((t) => t.includes("new-src/very/deeply/nested/module-0/index.ts"))).toBe(true);
  });

  // The caller's arithmetic going negative is what made the failure silent.
  test("refuses a budget that leaves no room for patch text", () => {
    expect(() => splitPatchIntoParts("diff --git a/a b/a\n+x\n", 10)).toThrow(/floor/);
  });
});
