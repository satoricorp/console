import { describe, expect, test } from "bun:test";
import { requireConvexSiteUrl, resolveConvexSiteUrl } from "./convex-env";

describe("convex env helpers", () => {
  test("uses the public Convex site URL when configured", () => {
    expect(
      resolveConvexSiteUrl({
        NEXT_PUBLIC_CONVEX_SITE_URL: " https://example.convex.site/ ",
        NEXT_PUBLIC_CONVEX_URL: "https://ignored.convex.cloud",
      }),
    ).toBe("https://example.convex.site");
  });

  test("uses the server Convex site URL fallback", () => {
    expect(
      resolveConvexSiteUrl({
        CONVEX_SITE_URL: "https://server-env.convex.site",
      }),
    ).toBe("https://server-env.convex.site");
  });

  test("derives the Convex site URL from the deployment URL", () => {
    expect(
      resolveConvexSiteUrl({
        NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
      }),
    ).toBe("https://example.convex.site");
  });

  test("throws a clear error when no site URL can be resolved", () => {
    expect(() => requireConvexSiteUrl({})).toThrow(
      "NEXT_PUBLIC_CONVEX_SITE_URL or CONVEX_SITE_URL must be set",
    );
  });
});
