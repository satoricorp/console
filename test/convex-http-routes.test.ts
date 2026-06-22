import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const httpSource = readFileSync(new URL("../convex/http.ts", import.meta.url), "utf8");

describe("Convex HTTP route ownership", () => {
  test("uses /cx for Convex-owned HTTP routes", () => {
    expect(httpSource).toContain('path: "/cx/auth/complete"');
    expect(httpSource).toContain('path: "/cx/github/webhook"');
    expect(httpSource).toContain('path: "/cx/stripe/webhook"');
  });

  test("does not expose legacy gx or CLI token routes", () => {
    expect(httpSource).not.toContain('path: "/gx/auth/');
    expect(httpSource).not.toContain('path: "/gx/pr"');
    expect(httpSource).not.toContain('path: "/cx/auth/revoke"');
    expect(httpSource).not.toContain('path: "/cx/pr"');
    expect(httpSource).not.toContain('path: "/cx/pr/comment"');
  });
});
