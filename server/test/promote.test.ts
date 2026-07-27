import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSql, runMigrations } from "../src/db";
import { parseSessionContent, promoteSessionRaw } from "../src/ingest/promote";
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

  test("promotes sessions_raw to session_events with raw_line lookup", async () => {
    const db = getSql();
    const content = "[cursor] edit src/foo.ts\nhello\n[cursor] message ctx";
    const capturedAt = 1_700_000_001_000;

    const [raw] = await db<{
      id: string;
      org_id: string;
      session_id: string;
      tool: string;
      model: string | null;
      content: string;
      captured_at_ms: number;
    }[]>`
      INSERT INTO sessions_raw (
        org_id, session_id, tool, model, content, captured_at_ms
      ) VALUES (
        ${orgId},
        'promote-test-1',
        'cursor',
        'gpt-4',
        ${content},
        ${capturedAt}
      )
      RETURNING id, org_id, session_id, tool, model, content, captured_at_ms
    `;

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

    const [rawA] = await db<{
      id: string;
      org_id: string;
      session_id: string;
      tool: string;
      model: string | null;
      content: string;
      captured_at_ms: number;
    }[]>`
      INSERT INTO sessions_raw (
        org_id, session_id, tool, model, content, captured_at_ms
      ) VALUES (
        ${orgId}, ${sessionId}, 'cursor', null, '[cursor] message one', 1000
      )
      RETURNING id, org_id, session_id, tool, model, content, captured_at_ms
    `;
    await promoteSessionRaw(db, rawA);

    const [rawB] = await db<{
      id: string;
      org_id: string;
      session_id: string;
      tool: string;
      model: string | null;
      content: string;
      captured_at_ms: number;
    }[]>`
      INSERT INTO sessions_raw (
        org_id, session_id, tool, model, content, captured_at_ms
      ) VALUES (
        ${orgId}, ${sessionId}, 'cursor', null, '[cursor] message two', 2000
      )
      RETURNING id, org_id, session_id, tool, model, content, captured_at_ms
    `;
    const repromote = await promoteSessionRaw(db, rawB);
    expect(repromote.skipped).toBe(false);
    expect(repromote.promoted).toBe(1);

    const rows = await db<{ raw_id: string; event_type: string }[]>`
      SELECT raw_id, event_type FROM session_events
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.raw_id).toBe(rawB.id);
  });
});
