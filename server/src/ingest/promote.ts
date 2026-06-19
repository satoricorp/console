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

/** Promote one sessions_raw row into session_events (idempotent per session_id+org_id). */
export async function promoteSessionRaw(
  db: postgres.Sql,
  row: SessionsRawRow,
): Promise<{ promoted: number; skipped: boolean }> {
  const existing = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM session_events
    WHERE org_id = ${row.org_id}
      AND session_id = ${row.session_id}
      AND raw_id = ${row.id}
  `;
  if (Number(existing[0]?.count ?? 0) > 0) {
    return { promoted: 0, skipped: true };
  }

  await db`
    DELETE FROM session_events
    WHERE org_id = ${row.org_id}
      AND session_id = ${row.session_id}
  `;

  const plaintext = decryptSessionContent(row.content);
  const parsed = parseSessionContent(
    plaintext,
    row.captured_at_ms,
    row.tool,
    row.model,
  );

  if (parsed.length === 0) {
    return { promoted: 0, skipped: false };
  }

  for (const ev of parsed) {
    await db`
      INSERT INTO session_events (
        org_id, session_id, tool, model, ts, event_type, file_path,
        content_hash, raw_id, raw_line
      ) VALUES (
        ${row.org_id},
        ${row.session_id},
        ${ev.tool},
        ${ev.model},
        ${ev.ts},
        ${ev.eventType},
        ${ev.filePath},
        ${ev.contentHash},
        ${row.id},
        ${ev.rawLine}
      )
    `;
  }

  return { promoted: parsed.length, skipped: false };
}
