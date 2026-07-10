import { describe, expect, test } from "bun:test";
import {
  patchFromPayload,
  revisionEntriesFromPayload,
} from "../convex/lib/gxPrPayload";

const pushBundle = {
  repo: { remote_url: "git@github.com:acme/widgets.git" },
  push: { head_commit_id: "abc123" },
  stack: [
    {
      change: {
        id: 1,
        jj_change_id: "rzlmkskwokkzwnqpxttqstlwrpvlmttl",
        current_commit_id: "abc123def456",
        description: "add login flow\n\nDetails here.",
        status: "pushed",
        files: ["src/login.ts"],
      },
      branch_name: "feature/login",
      base_branch_name: "main",
      patch: "diff --git a/src/login.ts b/src/login.ts\n+login",
      github_pull_request_url: "https://github.com/acme/widgets/pull/7",
    },
    {
      change: {
        id: 2,
        jj_change_id: "ttxkvrptslqloowtmtpxxvtkuwkktwlo",
        current_commit_id: "fed321",
        description: "add logout flow",
        status: "pushed",
        files: ["src/logout.ts"],
      },
      branch_name: "feature/login",
      base_branch_name: "main",
      patch: "diff --git a/src/logout.ts b/src/logout.ts\n+logout",
    },
  ],
};

describe("revisionEntriesFromPayload", () => {
  test("extracts one entry per stack revision", () => {
    const entries = revisionEntriesFromPayload(pushBundle);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      changeId: "rzlmkskwokkzwnqpxttqstlwrpvlmttl",
      commitId: "abc123def456",
      message: "add login flow\n\nDetails here.",
      branchName: "feature/login",
      baseBranchName: "main",
      pullRequestUrl: "https://github.com/acme/widgets/pull/7",
      stackIndex: 0,
    });
    expect(entries[1].pullRequestUrl).toBeUndefined();
    expect(entries[1].stackIndex).toBe(1);
  });

  test("skips malformed entries and non-bundle payloads", () => {
    expect(revisionEntriesFromPayload(null)).toEqual([]);
    expect(revisionEntriesFromPayload({ title: "legacy demo push" })).toEqual(
      [],
    );
    expect(
      revisionEntriesFromPayload({
        stack: [{ change: { description: "missing change id" } }, "junk"],
      }),
    ).toEqual([]);
  });
});

describe("patchFromPayload", () => {
  test("returns the patch for the matching change id", () => {
    expect(
      patchFromPayload(pushBundle, "ttxkvrptslqloowtmtpxxvtkuwkktwlo"),
    ).toContain("+logout");
  });

  test("returns null for unknown change ids and legacy payloads", () => {
    expect(patchFromPayload(pushBundle, "nope")).toBeNull();
    expect(patchFromPayload({ title: "legacy" }, "nope")).toBeNull();
  });
});
