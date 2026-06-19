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

export async function runMigrations(): Promise<void> {
  const db = getSql();

  await db`
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
    const [existing] = await db`
      SELECT filename FROM schema_migrations WHERE filename = ${file}
    `;
    if (existing) {
      continue;
    }

    const sqlText = await readFile(filePath, "utf8");
    await db.unsafe(sqlText);
    await db`
      INSERT INTO schema_migrations (filename) VALUES (${file})
    `;
    console.log(`Applied migration ${file}`);
  }
}
