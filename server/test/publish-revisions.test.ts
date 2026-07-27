import { describe, expect, test } from "bun:test";
import { publishRevisions } from "../src/publish/revisions";

const v1Bundle = {
  change: {
    jj_change_id: "topchange",
    current_commit_id: "abc999",
    description: "top change",
    files: ["src/top.ts"],
  },
  stack: [
    {
      change: {
        jj_change_id: "rzlmkskwokkzwnqpxttqstlwrpvlmttl",
        current_commit_id: "abc123",
        description: "add login flow\n\nDetails here.",
        files: ["src/login.ts"],
      },
      branch_name: "feature/login",
      base_branch_name: "main",
      patch: "diff --git a/src/login.ts b/src/login.ts\n+login",
      github_pull_request_url: "https://github.com/acme/widgets/pull/7",
    },
  ],
};

const v2Bundle = {
  revisions: [
    {
      revision_id: "qltmnmynnyzk",
      commit_id: "abc123",
      description: "add login flow",
      files: ["src/login.ts"],
      branch_name: "feature/login",
      base_branch_name: "main",
      patch: "diff --git a/src/login.ts b/src/login.ts\n+login",
      github_pull_request_url: "https://github.com/acme/widgets/pull/7",
    },
    {
      revision_id: "wwxkvrptslql",
      commit_id: "fed321",
      description: "add logout flow",
      files: ["src/logout.ts"],
      branch_name: "feature/login",
      base_branch_name: "main",
    },
  ],
};

describe("publishRevisions", () => {
  test("reads schema v2 revisions directly", () => {
    const revisions = publishRevisions(v2Bundle);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].revision_id).toBe("qltmnmynnyzk");
    expect(revisions[0].patch).toContain("+login");
    expect(revisions[1].patch).toBeUndefined();
    expect(revisions[1].base_branch_name).toBe("main");
  });

  test("maps legacy v1 stack entries, jj_change_id becoming revision_id", () => {
    const revisions = publishRevisions(v1Bundle);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revision_id: "rzlmkskwokkzwnqpxttqstlwrpvlmttl",
      commit_id: "abc123",
      description: "add login flow\n\nDetails here.",
      files: ["src/login.ts"],
      branch_name: "feature/login",
      base_branch_name: "main",
      github_pull_request_url: "https://github.com/acme/widgets/pull/7",
    });
  });

  test("falls back to the v1 top-level change when the stack is empty", () => {
    const revisions = publishRevisions({ change: v1Bundle.change, stack: [] });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revision_id).toBe("topchange");
    expect(revisions[0].branch_name).toBeUndefined();
  });

  test("prefers v2 revisions over a v1 stack when both are present", () => {
    const revisions = publishRevisions({ ...v1Bundle, ...v2Bundle });
    expect(revisions).toHaveLength(2);
    expect(revisions[0].revision_id).toBe("qltmnmynnyzk");
  });

  test("returns [] for junk payloads", () => {
    expect(publishRevisions({})).toEqual([]);
    expect(publishRevisions({ revisions: "junk", stack: 3 })).toEqual([]);
    expect(publishRevisions({ revisions: ["junk"] })).toEqual([]);
  });
});
