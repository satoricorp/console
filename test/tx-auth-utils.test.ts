import { describe, expect, test } from "bun:test";
import { betterAuthUserIdFromCreateResult } from "../convex/txAuthUtils";

describe("betterAuthUserIdFromCreateResult", () => {
  test("uses the Convex document id returned by the Better Auth adapter", () => {
    expect(betterAuthUserIdFromCreateResult({ _id: "auth-user-doc" })).toBe("auth-user-doc");
  });

  test("preserves an explicit userId when one is present", () => {
    expect(betterAuthUserIdFromCreateResult({ _id: "auth-user-doc", userId: "app-user" })).toBe(
      "app-user",
    );
  });

  test("accepts id for compatibility with adapter result shapes", () => {
    expect(betterAuthUserIdFromCreateResult({ id: "auth-user-id" })).toBe("auth-user-id");
  });

  test("throws when the adapter result has no usable id", () => {
    expect(() => betterAuthUserIdFromCreateResult({})).toThrow(
      "Better Auth user create response missing id",
    );
  });
});
