import { describe, expect, test } from "bun:test";
import { mergeBlockedReason, type GithubPullDetails } from "./gxPrGithub";

function pull(
  overrides: Partial<GithubPullDetails> &
    Pick<GithubPullDetails, "number" | "mergeable">,
): GithubPullDetails {
  return {
    html_url: "https://github.com/acme/repo/pull/1",
    state: "open",
    merged: false,
    draft: false,
    mergeable_state: "clean",
    head: { ref: "feature", sha: "abc" },
    base: { ref: "main" },
    ...overrides,
  };
}

describe("mergeBlockedReason", () => {
  test("does not block while GitHub is still computing mergeable", () => {
    expect(mergeBlockedReason(pull({ number: 12, mergeable: null }))).toBeNull();
  });

  test("blocks when mergeable is false due to conflicts", () => {
    expect(
      mergeBlockedReason(
        pull({ number: 12, mergeable: false, mergeable_state: "dirty" }),
      ),
    ).toMatch(/merge conflicts/);
  });

  test("blocks closed PRs", () => {
    expect(
      mergeBlockedReason(
        pull({ number: 12, mergeable: true, state: "closed" }),
      ),
    ).toMatch(/is closed/);
  });
});
