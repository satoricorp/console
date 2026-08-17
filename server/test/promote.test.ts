import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import {
  parseSessionContent,
  promoteSessionRaw,
  type SessionsRawRow,
} from "../src/ingest/promote";
import { describeDb } from "./db-gate";

describe("parseSessionContent", () => {
  test("parses edit and message lines", () => {
    const content = [
      "[cursor] message hello world",
      "[cursor] edit internal/foo.go",
      "new line one",
      "new line two",
      "[cursor] read",
    ].join("\n");

    const events = parseSessionContent(content, 1_700_000_000_000, "cursor", "gpt-4");
    expect(events).toHaveLength(3);
    expect(events[0]?.eventType).toBe("message");
    expect(events[0]?.rawLine).toBe(1);
    expect(events[1]?.eventType).toBe("edit");
    expect(events[1]?.filePath).toBe("internal/foo.go");
    expect(events[1]?.rawLine).toBe(2);
    expect(events[2]?.eventType).toBe("read");
  });

  test("assigns monotonic ts from captured_at_ms + raw_line", () => {
    const events = parseSessionContent(
      "[cursor] message\n[cursor] edit a.go\npatch",
      1000,
      "cursor",
      null,
    );
    expect(events[0]?.ts).toBe(1001);
    expect(events[1]?.ts).toBe(1002);
  });
});

describeDb("promoteSessionRaw", () => {
  let orgId: string;

  beforeAll(async () => {
    await runMigrations();
    const db = getSql();
    const [org] = await db<{ id: string }[]>`
      INSERT INTO orgs (plan, created_at_ms)
      VALUES ('free', ${Date.now()})
      RETURNING id
    `;
    orgId = org.id;
  });

  afterAll(async () => {
  });

  /** Insert a sessions_raw row exactly as POST /v1/sessions does, id and all. */
  async function stageRaw(
    sessionId: string,
    content: string,
    options: { model?: string | null; capturedAt?: number } = {},
  ): Promise<SessionsRawRow> {
    const [raw] = await getSql()<SessionsRawRow[]>`
      INSERT INTO sessions_raw (
        org_id, session_id, tool, model, content, captured_at_ms
      ) VALUES (
        ${orgId},
        ${sessionId},
        'cursor',
        ${options.model ?? null},
        ${content},
        ${options.capturedAt ?? 1_700_000_001_000}
      )
      RETURNING id, org_id, session_id, tool, model, content, captured_at_ms
    `;
    return raw;
  }

  async function eventsFor(sessionId: string) {
    return getSql()<{ raw_id: string | null; event_type: string; raw_line: number }[]>`
      SELECT raw_id, event_type, raw_line
      FROM session_events
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
      ORDER BY raw_line
    `;
  }

  test("promotes sessions_raw to session_events with raw_line lookup", async () => {
    const db = getSql();
    const raw = await stageRaw(
      "promote-test-1",
      "[cursor] edit src/foo.ts\nhello\n[cursor] message ctx",
      { model: "gpt-4" },
    );

    const first = await promoteSessionRaw(db, raw);
    expect(first.skipped).toBe(false);
    expect(first.promoted).toBe(2);

    const [editRow] = await db<{
      event_type: string;
      file_path: string;
      raw_line: number;
      line_text: string;
    }[]>`
      SELECT se.event_type, se.file_path, se.raw_line,
        split_part(sr.content, E'\n', se.raw_line) AS line_text
      FROM session_events se
      JOIN sessions_raw sr ON sr.id = se.raw_id
      WHERE se.raw_id = ${raw.id}
        AND se.event_type = 'edit'
    `;
    expect(editRow.file_path).toBe("src/foo.ts");
    expect(editRow.raw_line).toBe(1);
    expect(editRow.line_text).toContain("edit src/foo.ts");

    const second = await promoteSessionRaw(db, raw);
    expect(second.skipped).toBe(true);
    expect(second.promoted).toBe(0);
  });

  test("re-promote replaces events for same session_id", async () => {
    const db = getSql();
    const sessionId = "promote-test-replace";

    const rawA = await stageRaw(sessionId, "[cursor] message one", { capturedAt: 1000 });
    await promoteSessionRaw(db, rawA);

    const rawB = await stageRaw(sessionId, "[cursor] message two", { capturedAt: 2000 });
    const repromote = await promoteSessionRaw(db, rawB);
    expect(repromote.skipped).toBe(false);
    expect(repromote.promoted).toBe(1);

    const rows = await eventsFor(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.raw_id).toBe(rawB.id);
  });

  // The client retries a failed upload five times, and every attempt POSTs the
  // same content, which inserts a *new* sessions_raw row. The old guard keyed on
  // that brand-new row's id, so it never matched and every retry wiped and
  // rebuilt the session's events.
  test("skips a retry that re-uploads identical content under a new raw id", async () => {
    const db = getSql();
    const sessionId = "promote-test-retry";
    const content = "[cursor] edit src/a.ts\npatch\n[cursor] message ctx";

    const first = await stageRaw(sessionId, content);
    expect((await promoteSessionRaw(db, first)).promoted).toBe(2);

    const retry = await stageRaw(sessionId, content);
    expect(retry.id).not.toBe(first.id);

    const second = await promoteSessionRaw(db, retry);
    expect(second.skipped).toBe(true);
    expect(second.promoted).toBe(0);

    // Skipping must leave the events readable: consumers resolve line text
    // through (raw_id, raw_line), so the pointer has to stay valid.
    const rows = await eventsFor(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.every((event) => event.raw_id === first.id)).toBe(true);
  });

  // Promotion deletes before it inserts. Unwrapped, a throw in between left the
  // session with nothing — and the client's five retries repeated the wipe.
  test("keeps existing events when the rebuild fails", async () => {
    const db = getSql();
    const sessionId = "promote-test-rollback";

    const raw = await stageRaw(sessionId, "[cursor] message one\n[cursor] message two");
    expect((await promoteSessionRaw(db, raw)).promoted).toBe(2);

    // A raw row that is not in sessions_raw: the INSERT trips session_events'
    // raw_id foreign key, after the DELETE has already run.
    const orphan: SessionsRawRow = { ...raw, id: randomUUID(), content: "[cursor] message three" };
    await expect(promoteSessionRaw(db, orphan)).rejects.toThrow();

    const rows = await eventsFor(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.every((event) => event.raw_id === raw.id)).toBe(true);
  });

  test("promotes a transcript larger than one insert chunk", async () => {
    const db = getSql();
    const sessionId = "promote-test-chunked";
    const lines = Array.from({ length: 1_200 }, (_, i) => `[cursor] message m${i}`);

    const raw = await stageRaw(sessionId, lines.join("\n"));
    expect((await promoteSessionRaw(db, raw)).promoted).toBe(lines.length);

    const rows = await eventsFor(sessionId);
    expect(rows).toHaveLength(lines.length);
    expect(rows[0]?.raw_line).toBe(1);
    expect(rows.at(-1)?.raw_line).toBe(lines.length);
  });
});
