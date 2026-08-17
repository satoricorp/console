import { createHash } from "node:crypto";
import type postgres from "postgres";
import { decryptSessionContent } from "../crypto/vault";

export type SessionsRawRow = {
  id: string;
  org_id: string;
  session_id: string;
  tool: string;
  model: string | null;
  content: string;
  captured_at_ms: number;
};

export type ParsedSessionEvent = {
  eventType: string;
  filePath: string | null;
  ts: number;
  rawLine: number;
  contentHash: string;
  tool: string;
  model: string | null;
};

const headerRe = /^\[([^\]]+)\]\s+(\S+)(?:\s+(.*))?$/;

/** Parse line-oriented sessions_raw.content (matches internal/capture/extract/format.go). */
export function parseSessionContent(
  content: string,
  capturedAtMs: number,
  tool: string,
  model: string | null,
): ParsedSessionEvent[] {
  const lines = content.split("\n");
  const events: ParsedSessionEvent[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = i + 1;
    const line = lines[i] ?? "";
    const match = headerRe.exec(line);
    if (!match) {
      i++;
      continue;
    }

    const lineTool = match[1] ?? tool;
    const eventType = match[2] ?? "unknown";
    const rest = match[3]?.trim() ?? "";
    let filePath: string | null = null;
    const bodyLines = [line];

    if (eventType === "edit" && rest !== "") {
      filePath = rest;
      i++;
      while (i < lines.length && !headerRe.test(lines[i] ?? "")) {
        bodyLines.push(lines[i] ?? "");
        i++;
      }
    } else {
      i++;
    }

    const text = bodyLines.join("\n");
    events.push({
      eventType,
      filePath,
      ts: capturedAtMs + rawLine,
      rawLine,
      contentHash: hashLine(text),
      tool: lineTool,
      model,
    });
  }

  return events;
}

function hashLine(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Rows per INSERT statement.
 *
 * Promotion used to issue one INSERT per event: a real 564 KB transcript is 188
 * events, and a 1 MB upload (the client's ceiling) is ~330 sequential round
 * trips, all of them holding one of the ten pooled connections (src/db.ts).
 * Postgres caps a statement at 65535 bind parameters and an event binds 10, so
 * the hard ceiling is ~6500 rows; 500 keeps the statement small while making
 * every realistic transcript a single round trip.
 */
const insertChunkSize = 500;

const eventColumns = [
  "org_id",
  "session_id",
  "tool",
  "model",
  "ts",
  "event_type",
  "file_path",
  "content_hash",
  "raw_id",
  "raw_line",
] as const;

/**
 * Promote one sessions_raw row into session_events (idempotent per org_id+session_id).
 *
 * Everything that writes runs in one transaction, because promotion REPLACES a
 * session's events: it deletes them and rebuilds from this raw row. Unwrapped,
 * any throw after the DELETE — a bad row, a dropped connection, a decode error —
 * left the session with no events and nothing to rebuild them from, and the
 * client retries a failed upload five times, so one poison session destroyed its
 * own history five times over. Parsing happens before `begin` so a parse failure
 * cannot reach the delete at all, and so the connection is held only for the
 * database work.
 *
 * The skip is what makes a retry cheap. It keys on content, which is what the
 * client keys on too: the stager resets a session's attempt counter only when
 * its content hash changes (internal/storage/capture_stage.go), so a retry
 * re-sends byte-identical content and a grown transcript does not. Content
 * equality is also exactly the condition under which the existing rows are still
 * correct — consumers read line text back through the (raw_id, raw_line) pointer,
 * and that pointer resolves to the same text only if the raw content matches.
 */
export async function promoteSessionRaw(
  db: postgres.Sql,
  row: SessionsRawRow,
): Promise<{ promoted: number; skipped: boolean }> {
  const plaintext = decryptSessionContent(row.content);
  const parsed = parseSessionContent(
    plaintext,
    row.captured_at_ms,
    row.tool,
    row.model,
  );
  const [lockHigh, lockLow] = sessionLockKey(row.org_id, row.session_id);

  return db.begin(async (tx) => {
    // Serialize promotions of one session. Two uploads of the same session
    // otherwise interleave under READ COMMITTED — neither DELETE sees the
    // other's uncommitted rows — and the session ends up with both sets.
    await tx`SELECT pg_advisory_xact_lock(${lockHigh}, ${lockLow})`;

    if (await isAlreadyPromoted(tx, row)) {
      return { promoted: 0, skipped: true };
    }

    await tx`
      DELETE FROM session_events
      WHERE org_id = ${row.org_id}
        AND session_id = ${row.session_id}
    `;

    for (let i = 0; i < parsed.length; i += insertChunkSize) {
      const chunk = parsed.slice(i, i + insertChunkSize).map((ev) => ({
        org_id: row.org_id,
        session_id: row.session_id,
        tool: ev.tool,
        model: ev.model,
        ts: ev.ts,
        event_type: ev.eventType,
        file_path: ev.filePath,
        content_hash: ev.contentHash,
        raw_id: row.id,
        raw_line: ev.rawLine,
      }));
      await tx`INSERT INTO session_events ${tx(chunk, ...eventColumns)}`;
    }

    return { promoted: parsed.length, skipped: false };
  });
}

/**
 * True when this session's events were already built from identical raw content.
 *
 * This replaces a guard that read `raw_id = row.id`. That could never match: the
 * caller inserts the sessions_raw row and passes the id straight from RETURNING,
 * so nothing referenced it yet and the count was always 0 — every upload wiped
 * and rebuilt the session.
 *
 * The digest is taken over the *stored* content, not the decrypted plaintext, so
 * it can be compared against a prior row without decrypting it. When the vault
 * stub (src/crypto/vault.ts) becomes real non-deterministic encryption, digests
 * of separately-encrypted copies stop matching and this simply stops skipping —
 * a rebuild, which is the correct result either way.
 */
async function isAlreadyPromoted(
  tx: postgres.TransactionSql,
  row: SessionsRawRow,
): Promise<boolean> {
  const [prior] = await tx<{ sources: number; content_digest: string | null }[]>`
    WITH promoted AS (
      SELECT se.raw_id
      FROM session_events se
      WHERE se.org_id = ${row.org_id}
        AND se.session_id = ${row.session_id}
      GROUP BY se.raw_id
    )
    SELECT
      (SELECT count(*)::int FROM promoted) AS sources,
      (
        SELECT encode(sha256(convert_to(sr.content, 'UTF8')), 'hex')
        FROM sessions_raw sr
        WHERE sr.id = (SELECT raw_id FROM promoted LIMIT 1)
      ) AS content_digest
  `;

  // Anything other than one surviving source row (none yet, several after some
  // older interleaving, or a raw row since deleted leaving raw_id NULL) is not
  // a state this upload can be shown to already match: rebuild.
  return prior?.sources === 1 && prior.content_digest === digestContent(row.content);
}

function digestContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Per-session advisory lock key, as the two int4s the two-argument form takes.
 * Transaction-scoped, so it is released by commit or rollback — a session-level
 * lock would leak across the connection pool (see the note in src/db.ts).
 */
function sessionLockKey(orgId: string, sessionId: string): [number, number] {
  const digest = createHash("sha256").update(`${orgId}\u0000${sessionId}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}
