import { describe, expect, test } from "bun:test";
import {
  isGxSupportedReview,
  isNoDataReview,
  partitionReviewsList,
  type ReviewListItem,
} from "./reviews-list";

function item(
  overrides: Partial<ReviewListItem> & Pick<ReviewListItem, "id">,
): ReviewListItem {
  return {
    repo_full_name: "acme/gx",
    branch_name: "feat/x",
    title: "Example",
    revision: 1,
    merge_status: "open",
    updated_at_ms: 1,
    github_pr_url: null,
    github_pr_number: null,
    latest_event_id: "event-1",
    file_count: 2,
    archived_at_ms: null,
    plan_status: null,
    plan_error: null,
    ...overrides,
  };
}

describe("isGxSupportedReview / isNoDataReview", () => {
  test("webhook-only shells without latest_event_id are not GX-supported", () => {
    const webhookOnly = item({
      id: "webhook",
      latest_event_id: null,
      github_pr_number: 12,
      github_pr_url: "https://github.com/acme/gx/pull/12",
      file_count: 0,
    });
    expect(isGxSupportedReview(webhookOnly)).toBe(false);
    expect(isNoDataReview(webhookOnly)).toBe(true);
  });

  test("failed empty plans with GX evidence are no-data", () => {
    const empty = item({
      id: "empty",
      plan_status: "failed",
      plan_error: "no_surviving_changes",
      file_count: 0,
    });
    expect(isGxSupportedReview(empty)).toBe(true);
    expect(isNoDataReview(empty)).toBe(true);
  });
});

describe("partitionReviewsList", () => {
  const open = item({ id: "open" });
  const merged = item({ id: "merged", merge_status: "merged" });
  const closed = item({ id: "closed", merge_status: "closed" });
  const archived = item({ id: "archived", archived_at_ms: 100 });
  const archivedMerged = item({
    id: "archived-merged",
    merge_status: "merged",
    archived_at_ms: 100,
  });
  const noData = item({
    id: "no-data",
    plan_status: "failed",
    plan_error: "no_surviving_changes",
    file_count: 0,
  });
  const webhookOnly = item({
    id: "webhook-only",
    latest_event_id: null,
    github_pr_number: 99,
    file_count: 0,
  });

  test("hides merged by default and keeps closed visible", () => {
    const result = partitionReviewsList(
      [open, merged, closed, archived, archivedMerged, noData, webhookOnly],
      { showArchived: false, showMerged: false },
    );
    expect(result.visible.map((b) => b.id)).toEqual(["open", "closed"]);
    expect(result.noData.map((b) => b.id).sort()).toEqual([
      "no-data",
      "webhook-only",
    ]);
    expect(result.mergedCount).toBe(2);
    expect(result.archivedCount).toBe(2);
  });

  test("showMerged includes merged non-archived reviews", () => {
    const result = partitionReviewsList([open, merged, archivedMerged], {
      showArchived: false,
      showMerged: true,
    });
    expect(result.visible.map((b) => b.id)).toEqual(["open", "merged"]);
  });

  test("showArchived still respects merged filter", () => {
    const result = partitionReviewsList([archived, archivedMerged], {
      showArchived: true,
      showMerged: false,
    });
    expect(result.visible.map((b) => b.id)).toEqual(["archived"]);
  });
});
