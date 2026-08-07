import { describe, expect, test } from "bun:test";
import { TtlCache } from "../src/middleware/ttl-cache";

function fixedClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("TtlCache", () => {
  test("returns a value inside its TTL", () => {
    const clock = fixedClock();
    const cache = new TtlCache<string>({
      ttlMs: 1_000,
      maxEntries: 10,
      now: clock.now,
    });

    cache.set("k", "v");
    clock.advance(999);

    expect(cache.get("k")).toBe("v");
  });

  test("expires an entry once its TTL elapses", () => {
    const clock = fixedClock();
    const cache = new TtlCache<string>({
      ttlMs: 1_000,
      maxEntries: 10,
      now: clock.now,
    });

    cache.set("k", "v");
    clock.advance(1_000);

    expect(cache.get("k")).toBeUndefined();
    // The read drops it rather than leaving a dead entry behind.
    expect(cache.size).toBe(0);
  });

  test("a rewrite restarts the TTL", () => {
    const clock = fixedClock();
    const cache = new TtlCache<string>({
      ttlMs: 1_000,
      maxEntries: 10,
      now: clock.now,
    });

    cache.set("k", "v");
    clock.advance(900);
    cache.set("k", "v2");
    clock.advance(900);

    expect(cache.get("k")).toBe("v2");
  });

  test("never grows past maxEntries, dropping the oldest writes", () => {
    const clock = fixedClock();
    const cache = new TtlCache<number>({
      ttlMs: 60_000,
      maxEntries: 3,
      now: clock.now,
    });

    for (let i = 0; i < 100; i += 1) {
      cache.set(`k${i}`, i);
    }

    expect(cache.size).toBe(3);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k96")).toBeUndefined();
    expect(cache.get("k97")).toBe(97);
    expect(cache.get("k99")).toBe(99);
  });

  test("clear empties the cache", () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, maxEntries: 10 });
    cache.set("k", "v");
    cache.clear();
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
