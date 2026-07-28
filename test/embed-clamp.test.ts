import { describe, expect, test } from "bun:test";
import { chunkSourceFile } from "../convex/lib/turbopuffer/chunkSourceFile";
import { clampEmbeddingInput } from "../convex/lib/turbopuffer/embedTextBatch";

/**
 * text-embedding-3-small rejects the whole request above 8192 tokens, not just
 * the offending item — so one oversized chunk fails its batch, and a failed
 * batch aborts the run. satoricorp/console stopped at file 250 of 421 that way,
 * leaving a partial index and a failed job.
 *
 * The chunker bounds by lines, which does not bound size. Both shapes below are
 * under the 100KB per-file cap and inside CHUNK_LINES, and both produced a
 * single chunk of hundreds of thousands of characters.
 */
describe("chunks are bounded by size, not only by line count", () => {
  const MAX = 16000;

  test("a minified bundle is one line and must still embed", () => {
    const minified = `!function(e,t){"use strict";${"a".repeat(180000)}}(window,document);`;
    const chunks = chunkSourceFile("acme/api", "abc123", "public/bundle.min.js", minified);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX);
    }
  });

  test("data with no symbol boundaries does not become one huge chunk", () => {
    // No `const`/`function`, so nothing splits it: the whole window is one chunk.
    const data = Array.from(
      { length: 100 },
      (_, i) => `  "key${i}": "${"v".repeat(3000)}",`,
    ).join("\n");
    const chunks = chunkSourceFile("acme/api", "abc123", "src/fixtures.json", data);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX);
    }
  });

  test("the header survives clamping, so a clamped chunk can still be cited", () => {
    const data = Array.from({ length: 60 }, () => "y".repeat(3000)).join("\n");
    for (const chunk of chunkSourceFile("acme/api", "abc123", "src/huge.ts", data)) {
      expect(chunk.content).toContain("src/huge.ts");
    }
  });

  test("ordinary source is not truncated", () => {
    const source = Array.from({ length: 40 }, (_, i) => `  const x${i} = ${i};`).join("\n");
    const chunks = chunkSourceFile("acme/api", "abc123", "src/small.ts", source);
    expect(chunks.some((c) => c.content.includes("const x39 = 39;"))).toBe(true);
  });

  test("the embedder clamps independently, so no future caller can blow the limit", () => {
    expect(clampEmbeddingInput("x".repeat(50000)).length).toBe(20000);
    expect(clampEmbeddingInput("short")).toBe("short");
  });
});
