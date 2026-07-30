import { describe, expect, test } from "bun:test";
import { withUnindexedNotice } from "../src/github/pr-body";

/**
 * A summary written without the repository's source reads exactly like one
 * written with it: same shape, same confidence, just blind to anything the
 * diff does not show. The reader has no way to tell, which is what makes
 * stating it worth the line.
 */
describe("unindexed-repository notice", () => {
  test("says what was missing and where to fix it", () => {
    const body = withUnindexedNotice("## Summary\n\nSomething changed.", false);

    expect(body).toContain("Something changed.");
    expect(body).toContain("without this repository's source indexed");
    expect(body).toContain("https://gx.run/repositories");
    // The website, not the hidden maintenance command that fills one
    // developer's namespace from one developer's checkout.
    expect(body).not.toContain("tx index");
  });

  test("stays out of the way when the summary did see the source", () => {
    const content = "## Summary\n\nSomething changed.";
    expect(withUnindexedNotice(content, true)).toBe(content);
  });

  test("does not stack a second notice onto trailing whitespace", () => {
    const once = withUnindexedNotice("## Summary\n\n\n", false);
    expect(once.match(/gx\.run\/repositories/g)).toHaveLength(1);
    expect(once).not.toContain("\n\n\n>");
  });
});
