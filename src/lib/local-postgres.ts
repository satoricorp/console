import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

export function getLocalSql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!sql) {
    sql = postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
  }
  return sql;
}

export async function loadBookmarkPayload(bookmarkId: string): Promise<unknown | null> {
  const db = getLocalSql();
  const rows = await db<{ payload: unknown | null }[]>`
    SELECT e.payload
    FROM gx_bookmarks b
    LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
    WHERE b.id = ${bookmarkId}
    LIMIT 1
  `;
  return rows[0]?.payload ?? null;
}
