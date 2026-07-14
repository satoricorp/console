import { describe, expect, test } from "bun:test";
import type { ReviewPlan, ReviewResponse } from "@/lib/reviews-client";
import { findNotablePatch } from "./critical-review-card";

describe("findNotablePatch", () => {
  test("matches legacy patches that omitted rank", () => {
    const change: ReviewPlan["notableChanges"][number] = {
      rank: 2,
      category: "architecture",
      title: "Canonical linking",
      whyItMatters: "Links reviews to pull requests.",
      anchor: {
        file: "server/src/bookmarks/canonical-pr.ts",
        revisionChangeId: "abc123",
      },
      anchorConfidence: "file",
    };
    const patch: ReviewResponse["notablePatches"][number] = {
      file: "server/src/bookmarks/canonical-pr.ts",
      revisionChangeId: "abc123",
      patch: "diff --git a/file b/file",
    };

    expect(findNotablePatch([patch], change)).toBe(patch);
  });
});
