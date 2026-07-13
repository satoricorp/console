import { describe, expect, test } from "bun:test";
import { userFacingActionError } from "./convex-action-error";

describe("userFacingActionError", () => {
  test("returns fallback for non-errors", () => {
    expect(userFacingActionError(null, "fallback")).toBe("fallback");
  });

  test("unwraps Convex Server Error wrappers", () => {
    const err = new Error(
      "[CONVEX A(gxPrActions:approveAndMergePullRequest)] [Request ID: abc] Server Error\nUncaught Error: Pull request #12 is closed and cannot be merged.",
    );
    expect(userFacingActionError(err, "fallback")).toBe(
      "Pull request #12 is closed and cannot be merged.",
    );
  });

  test("passes through plain messages", () => {
    expect(
      userFacingActionError(new Error("Sign in with GitHub"), "fallback"),
    ).toBe("Sign in with GitHub");
  });
});
