import { describe, expect, test } from "bun:test";
import {
  bookmarksMissingFromOpenSet,
  groupBookmarksByRepo,
  mergeStatusFromGithubPull,
} from "../src/bookmarks/merge-status";

describe("mergeStatusFromGithubPull", () => {
  test("prefers merged over closed state", () => {
    expect(
      mergeStatusFromGithubPull({ merged: true, state: "closed" }),
    ).toBe("merged");
  });

  test("maps closed unmerged PRs", () => {
    expect(
      mergeStatusFromGithubPull({ merged: false, state: "closed" }),
    ).toBe("closed");
  });

  test("keeps open PRs open", () => {
    expect(mergeStatusFromGithubPull({ merged: false, state: "open" })).toBe(
      "open",
    );
  });
});

describe("groupBookmarksByRepo", () => {
  test("groups bookmarks by repo_full_name", () => {
    const grouped = groupBookmarksByRepo([
      { id: "a", repo_full_name: "acme/one", github_pr_number: 1 },
      { id: "b", repo_full_name: "acme/two", github_pr_number: 2 },
      { id: "c", repo_full_name: "acme/one", github_pr_number: 3 },
    ]);
    expect([...grouped.keys()].sort()).toEqual(["acme/one", "acme/two"]);
    expect(grouped.get("acme/one")?.map((b) => b.id)).toEqual(["a", "c"]);
    expect(grouped.get("acme/two")?.map((b) => b.id)).toEqual(["b"]);
  });
});

describe("bookmarksMissingFromOpenSet", () => {
  test("keeps only PRs absent from the open set", () => {
    const stale = bookmarksMissingFromOpenSet(
      [
        { id: "open", github_pr_number: 10 },
        { id: "merged", github_pr_number: 11 },
        { id: "null", github_pr_number: null },
      ],
      new Set([10]),
    );
    expect(stale.map((b) => b.id)).toEqual(["merged"]);
  });
});
