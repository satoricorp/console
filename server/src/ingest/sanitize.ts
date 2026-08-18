/**
 * Make text safe for a Postgres `text` column.
 *
 * Postgres cannot store NUL (U+0000) in text: the insert fails with
 * `invalid byte sequence for encoding "UTF8": 0x00`. Nothing in the ingest
 * route catches that, and the app installs no error handler, so the throw
 * reaches the client as a bare 500 with nothing written to the logs. The
 * capture client retries a failed session upload five times and then
 * quarantines it, so one such session is lost permanently and silently.
 *
 * These bytes are not corruption, which is why the case is worth handling
 * rather than rejecting. A transcript that discusses binary detection quotes
 * real NULs -- sample.includes("\u0000"), "SQLite format 3\u0000" -- so the
 * sessions most likely to carry them are precisely the ones about handling
 * binary data. U+FFFD keeps the position visible instead of silently closing
 * the quotes.
 */
export function replaceNullChars(value: string): string {
  return value.includes("\u0000") ? value.replaceAll("\u0000", "\uFFFD") : value;
}

/**
 * Apply replaceNullChars to every string in a JSON-shaped value.
 *
 * A publish bundle is stored whole in a jsonb column, and jsonb rejects
 * \u0000 inside any string with `unsupported Unicode escape sequence` -- so a
 * single NUL anywhere in one revision's patch failed the entire publish, the
 * same defect as the sessions_raw text column but with a wider blast radius.
 * Patches carry them for ordinary reasons: a diff of a file that contains NULs,
 * or a fixture written to exercise binary detection.
 *
 * Sanitizing at the boundary, immediately after validation, covers the stored
 * payload and everything derived from it downstream -- bookmark title,
 * revisions, indexing -- from one place.
 */
export function replaceNullCharsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return replaceNullChars(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceNullCharsDeep(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[replaceNullChars(key)] = replaceNullCharsDeep(item);
    }
    return out as T;
  }
  return value;
}
