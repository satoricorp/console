import { describe, expect, test } from "bun:test";
import {
  bookmarksMissingFromOpenSet,
  groupBookmarksByRepo,
  mapPool,
  mergeStatusFromGithubPull,
  parseGithubPrNumber,
  resolveGithubPrNumber,
} from "../src/bookmarks/merge-status";

describe("mergeStatusFromGithubPull", () => {
  test("prefers merged over closed state", () => {
    expect(
      mergeStatusFromGithubPull({ merged: true, state: "closed" }),
    ).toBe("merged");
  });

  test("treats merged_at as merged even if merged flag is missing", () => {
    expect(
      mergeStatusFromGithubPull({
        state: "closed",
        merged_at: "2026-07-01T12:00:00Z",
      }),
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

describe("parseGithubPrNumber / resolveGithubPrNumber", () => {
  test("parses PR numbers from github URLs", () => {
    expect(parseGithubPrNumber("https://github.com/acme/gx/pull/42")).toBe(42);
    expect(parseGithubPrNumber("https://github.com/acme/gx/pull/42/files")).toBe(
      42,
    );
    expect(parseGithubPrNumber(null)).toBe(null);
  });

  test("prefers stored number then falls back to URL", () => {
    expect(
      resolveGithubPrNumber({
        github_pr_number: 7,
        github_pr_url: "https://github.com/acme/gx/pull/99",
      }),
    ).toBe(7);
    expect(
      resolveGithubPrNumber({
        github_pr_number: null,
        github_pr_url: "https://github.com/acme/gx/pull/99",
      }),
    ).toBe(99);
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

  test("resolves PR number from URL when github_pr_number is null", () => {
    const stale = bookmarksMissingFromOpenSet(
      [
        {
          id: "url-only",
          github_pr_number: null,
          github_pr_url: "https://github.com/acme/gx/pull/11",
        },
      ],
      new Set([10]),
    );
    expect(stale.map((b) => b.id)).toEqual(["url-only"]);
  });
});

describe("mapPool", () => {
  test("runs all items with bounded concurrency", async () => {
    const seen: number[] = [];
    let active = 0;
    let maxActive = 0;
    await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(n);
      await Bun.sleep(5);
      active -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
