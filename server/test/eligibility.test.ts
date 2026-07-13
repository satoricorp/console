import { describe, expect, test } from "bun:test";
import {
  isReviewEligibleBookmark,
  WEBHOOK_BOOKMARK_USER,
} from "../src/bookmarks/eligibility";

describe("isReviewEligibleBookmark", () => {
  test("requires real publisher, event, and PR", () => {
    expect(
      isReviewEligibleBookmark({
        id: "a",
        user_id: "github:1",
        latest_event_id: "e1",
        github_pr_number: 12,
        event_user_id: "github:1",
      }),
    ).toBe(true);
  });

  test("rejects webhook shells", () => {
    expect(
      isReviewEligibleBookmark({
        id: "a",
        user_id: WEBHOOK_BOOKMARK_USER,
        latest_event_id: "e1",
        github_pr_number: 12,
        event_user_id: "github:1",
      }),
    ).toBe(false);
  });

  test("rejects missing PR", () => {
    expect(
      isReviewEligibleBookmark({
        id: "a",
        user_id: "github:1",
        latest_event_id: "e1",
        github_pr_number: null,
        event_user_id: "github:1",
      }),
    ).toBe(false);
  });

  test("rejects missing event", () => {
    expect(
      isReviewEligibleBookmark({
        id: "a",
        user_id: "github:1",
        latest_event_id: null,
        github_pr_number: 3,
      }),
    ).toBe(false);
  });

  test("rejects event/owner mismatch", () => {
    expect(
      isReviewEligibleBookmark({
        id: "a",
        user_id: "github:1",
        latest_event_id: "e1",
        github_pr_number: 3,
        event_user_id: WEBHOOK_BOOKMARK_USER,
      }),
    ).toBe(false);
  });

  test("rejects unavailable GitHub PRs", () => {
    expect(
      isReviewEligibleBookmark({
        id: "a",
        user_id: "github:1",
        latest_event_id: "e1",
        github_pr_number: 3,
        event_user_id: "github:1",
        github_unavailable_at_ms: Date.now(),
      }),
    ).toBe(false);
  });
});
