import { describe, expect, test } from "bun:test";
import { resolveHunkFileLines } from "../src/ingest/parse-hunk";

describe("resolveHunkFileLines", () => {
  test("parses Go hunkID format", () => {
    const r = resolveHunkFileLines({
      hunkID: "abc123:internal/capture/event.go:1-12",
      tier: 1,
      confidence: 1,
      authorship: "agent",
    });
    expect(r.file).toBe("internal/capture/event.go");
    expect(r.lineStart).toBe(1);
    expect(r.lineEnd).toBe(12);
  });

  test("prefers explicit file fields", () => {
    const r = resolveHunkFileLines({
      hunkID: "x",
      file: "foo.go",
      lineStart: 5,
      lineEnd: 10,
      tier: 2,
      confidence: 0.8,
      authorship: "agent",
    });
    expect(r.file).toBe("foo.go");
    expect(r.lineStart).toBe(5);
    expect(r.lineEnd).toBe(10);
  });
});
