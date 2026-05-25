import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sql: ReturnType<typeof postgres> | null = null;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
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

export async function runMigrations(): Promise<void> {
  const db = getSql();
  const migrationsDir = path.resolve(__dirname, "../migrations");
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await db`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  for (const file of files) {
    const [existing] = await db`
      SELECT filename FROM schema_migrations WHERE filename = ${file}
    `;
    if (existing) {
      continue;
    }

    const sqlText = await readFile(path.join(migrationsDir, file), "utf8");
    await db.unsafe(sqlText);
    await db`
      INSERT INTO schema_migrations (filename) VALUES (${file})
    `;
    console.log(`Applied migration ${file}`);
  }
}
