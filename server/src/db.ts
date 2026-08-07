import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../");

let sql: ReturnType<typeof postgres> | null = null;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) {
    return url;
  }

  const host = process.env.PGHOST;
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error("DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD is not set");
  }

  const params = new URLSearchParams();
  const sslMode = process.env.PGSSLMODE;
  if (sslMode) {
    params.set("sslmode", sslMode);
  }

  const connection = new URL("postgres://");
  connection.hostname = host;
  connection.port = port;
  connection.pathname = database;
  connection.username = user;
  connection.password = password;
  connection.search = params.toString();
  return connection.toString();
}

export function getSql() {
  if (!sql) {
    sql = postgres(getDatabaseUrl(), {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

export async function pingDatabase(): Promise<void> {
  await getSql()`SELECT 1`;
}

export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}

const migrationsDir = path.join(repoRoot, "server/migrations");

/**
 * Advisory lock key for the migration runner. Arbitrary but fixed: any two
 * processes that might migrate the same database must pick the same number.
 */
const migrationLockKey = 8_476_223_101;

/**
 * Applies pending migrations, serialized against every other caller.
 *
 * The lock is not belt-and-braces. Without it, concurrent callers each read
 * schema_migrations, each conclude the same file is unapplied, and each run it:
 * the DDL then contends on ACCESS EXCLUSIVE locks and the duplicate
 * schema_migrations INSERT fails on the primary key. Two places do exactly
 * that today — the server runs migrations at startup and ECS runs more than one
 * task, and 19 test files call this in `beforeAll` against one database, which
 * is what made the suite flaky: on a cold database the pile-up regularly
 * exceeded the 5s hook timeout, failing a different arbitrary subset of tests
 * on each run and never reproducing locally against an already-migrated one.
 *
 * A session-level lock on a RESERVED connection, not a pooled one: postgres.js
 * hands each query whatever connection is free, so a lock taken on one and
 * released on another would leak and deadlock the next caller. The reserved
 * connection is released in `finally` so a failing migration cannot wedge every
 * later process.
 */
export async function runMigrations(): Promise<void> {
  const db = getSql();
  const connection = await db.reserve();
  try {
    await connection`SELECT pg_advisory_lock(${migrationLockKey})`;
    try {
      await connection`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      const files = (await readdir(migrationsDir))
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => path.join(migrationsDir, file));

      for (const filePath of files) {
        const file = path.basename(filePath);
        const [existing] = await connection`
          SELECT filename FROM schema_migrations WHERE filename = ${file}
        `;
        if (existing) {
          continue;
        }

        const sqlText = await readFile(filePath, "utf8");
        await connection.unsafe(sqlText);
        await connection`
          INSERT INTO schema_migrations (filename) VALUES (${file})
        `;
        console.log(`Applied migration ${file}`);
      }
    } finally {
      await connection`SELECT pg_advisory_unlock(${migrationLockKey})`;
    }
  } finally {
    connection.release();
  }
}
