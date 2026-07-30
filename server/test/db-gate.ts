import { describe } from "bun:test";

/**
 * Shared gate for the database-backed suites.
 *
 * These tests used to each define `const describeDb = hasDb ? describe : describe.skip`,
 * which meant a missing DATABASE_URL silently turned ~59 assertions — publish
 * intake, the GitHub webhook, tenant isolation, the /bookmarks compat alias —
 * into a green run. A skipped security test that looks identical to a passing
 * one is worse than no test at all, so:
 *
 *   - In CI, a missing database is a hard failure. It must not be possible for
 *     a workflow to go green without the database paths having run.
 *   - Locally, the skip is announced once, loudly, with the command to fix it.
 *
 * Escape hatch for a deliberate no-database run: TX_TEST_ALLOW_NO_DB=1.
 */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

const RUN_HINT = "bun run test:db  (server/scripts/test-db.sh — provisions a scratch Postgres)";

if (!hasDatabase) {
  if (process.env.CI && process.env.TX_TEST_ALLOW_NO_DB !== "1") {
    throw new Error(
      `DATABASE_URL is not set. The database-backed tests cannot silently skip in CI.\n` +
        `Provide a Postgres service, or set TX_TEST_ALLOW_NO_DB=1 to acknowledge the gap.\n` +
        `Locally: ${RUN_HINT}`,
    );
  }
  console.warn(
    `\n\x1b[33m! DATABASE_URL is not set — the database-backed tests will SKIP.\x1b[0m\n` +
      `  Those cover publish intake, the GitHub webhook, org isolation and the\n` +
      `  /bookmarks compat alias. A green run here does not cover any of them.\n` +
      `  Run them with: \x1b[1m${RUN_HINT}\x1b[0m\n`,
  );
}

/** `describe` when a database is configured, `describe.skip` otherwise. */
export const describeDb = hasDatabase ? describe : describe.skip;
