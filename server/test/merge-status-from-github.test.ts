import { describe, expect, test } from "bun:test";
import { mergeStatusFromGithubPull } from "../src/routes/reviews";

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
