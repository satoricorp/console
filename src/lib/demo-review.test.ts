import { describe, expect, test } from "bun:test";
import {
  DEMO_REVIEW_LIST,
  DEMO_REVIEWS,
  getDemoReview,
} from "./demo-review";

describe("GX reviews demo data", () => {
  test("includes ten reviews across three repositories", () => {
    expect(DEMO_REVIEW_LIST).toHaveLength(10);
    expect(new Set(DEMO_REVIEW_LIST.map((review) => review.repo_full_name)).size).toBe(
      3,
    );
  });

  test("provides a complete detail review for every list item", () => {
    expect(DEMO_REVIEWS).toHaveLength(DEMO_REVIEW_LIST.length);
    for (const item of DEMO_REVIEW_LIST) {
      const review = getDemoReview(item.id);
      expect(review?.bookmark.id).toBe(item.id);
      expect(review?.plan.status).toBe("ready");
      expect(review?.plan.plan?.notableChanges.length).toBeGreaterThan(0);
    }
  });
});
