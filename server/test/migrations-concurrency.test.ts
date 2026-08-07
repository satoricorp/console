import { describe, expect, test } from "bun:test";

import { runMigrations } from "../src/db";
import { describeDb } from "./db-gate";

/**
 * Nineteen test files call runMigrations() in `beforeAll` against one database,
 * and the server calls it at startup on every ECS task. Before the advisory
 * lock those callers raced: each read schema_migrations, each decided the same
 * file was unapplied, and each ran it — contending on DDL locks and colliding
 * on the schema_migrations primary key.
 *
 * It never reproduced locally, because a warm database makes every call a
 * no-op and a fast machine hides the contention. It reproduced constantly in
 * CI against a cold database, as a different arbitrary subset of tests timing
 * out in a `beforeEach` hook on every run.
 */
describeDb("runMigrations under concurrency", () => {
  test("many simultaneous callers all succeed", async () => {
    const callers = 12;
    const results = await Promise.allSettled(
      Array.from({ length: callers }, () => runMigrations()),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(
      rejected.length,
      `${rejected.length}/${callers} concurrent runMigrations() calls failed: ` +
        rejected
          .map((r) => String((r as PromiseRejectedResult).reason).slice(0, 160))
          .join(" | "),
    ).toBe(0);
  });
});
