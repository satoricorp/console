import { describe, expect, test } from "bun:test";
import { BASE_FREE_RUNS, computeFreeRuns } from "../convex/lib/freeRuns";

describe("computeFreeRuns", () => {
  test("defaults to the base allowance", () => {
    expect(computeFreeRuns({})).toBe(BASE_FREE_RUNS);
  });

  test("community bonuses add on top", () => {
    expect(
      computeFreeRuns({ discordBonusClaimedAt: 1, twitterBonusClaimedAt: 2 }),
    ).toBe(BASE_FREE_RUNS + 4);
  });

  test("an operator override replaces the whole allowance, bonuses included", () => {
    expect(
      computeFreeRuns({
        freeRunsOverride: 50,
        discordBonusClaimedAt: 1,
        twitterBonusClaimedAt: 2,
      }),
    ).toBe(50);
  });

  test("an override of zero means zero — it is not treated as unset", () => {
    expect(computeFreeRuns({ freeRunsOverride: 0 })).toBe(0);
  });

  test("overrides are floored and never negative", () => {
    expect(computeFreeRuns({ freeRunsOverride: 9.7 })).toBe(9);
    expect(computeFreeRuns({ freeRunsOverride: -3 })).toBe(0);
  });
});
