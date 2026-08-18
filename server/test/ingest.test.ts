import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/app";
import { getSql, runMigrations } from "../src/db";
import { authHeaders, installTestAuth } from "./auth";
import { describeDb } from "./db-gate";

describeDb("ingest routes", () => {
  let orgId: string;

  beforeAll(async () => {
    installTestAuth();
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

  test("POST /v1/extracts inserts pr_event and hunk_links", async () => {
    const res = await app.request("http://localhost/v1/extracts", {
      method: "POST",
      headers: {
        ...authHeaders("ingest-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repoRoot: "/Users/joe/git/gx",
        refRange: "main..HEAD",
        headCommit: "deadbeef",
        hunkLinks: [
          {
            hunkID: "deadbeef:internal/capture/event.go:1-3",
            sessionID: "cursor-session-1",
            tier: 1,
            confidence: 1,
            authorship: "agent",
            tool: "cursor",
            model: "gpt-4",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { eventId: string; hunkLinksInserted: number };
    expect(json.hunkLinksInserted).toBe(1);

    const db = getSql();
    const [link] = await db<{ file: string; session_id: string }[]>`
      SELECT file, session_id FROM hunk_links WHERE event_id = ${json.eventId}
    `;
    expect(link.file).toBe("internal/capture/event.go");
    expect(link.session_id).toBe("cursor-session-1");
  });

  test("POST /v1/sessions inserts sessions_raw", async () => {
    const res = await app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: {
        ...authHeaders("ingest-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "cursor-session-1",
        tool: "cursor",
        model: "gpt-4",
        content: "[cursor] message line1\n[cursor] message redacted content",
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      sessionRawId: string;
      promotionStatus: string;
      eventsPromoted?: number;
    };
    expect(json.promotionStatus).toBe("done");
    expect(json.eventsPromoted).toBeGreaterThan(0);

    const db = getSql();
    const [raw] = await db<{ content: string }[]>`
      SELECT content FROM sessions_raw WHERE id = ${json.sessionRawId}
    `;
    expect(raw.content).toContain("redacted content");
  });

  // A transcript that discusses binary detection quotes real NULs, and Postgres
  // `text` cannot hold one: the insert threw, the route caught nothing, and the
  // client saw a bare 500 it retried five times before quarantining the session
  // for good. Sessions about handling binary data were the ones being lost.
  test("POST /v1/sessions accepts content containing NUL bytes", async () => {
    const content = [
      "[claude] message probe",
      '[claude] edit convex/lib/turbopuffer/utils.ts',
      '  if (sample.includes("\u0000")) return true;',
    ].join("\n");

    const res = await app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: {
        ...authHeaders("ingest-test-user", orgId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "nul-byte-session",
        tool: "claude",
        content,
        capturedAtMs: Date.now(),
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { sessionRawId: string; eventsPromoted?: number };
    expect(json.eventsPromoted).toBeGreaterThan(0);

    const db = getSql();
    const [raw] = await db<{ content: string }[]>`
      SELECT content FROM sessions_raw WHERE id = ${json.sessionRawId}
    `;
    // Stored, readable, and marked where the byte was rather than silently
    // closing the quotes.
    expect(raw.content).not.toContain("\u0000");
    expect(raw.content).toContain("sample.includes");
    expect(raw.content).toContain("\uFFFD");
  });

  test("rejects missing auth", async () => {
    const res = await app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "x",
        tool: "cursor",
        content: "hi",
      }),
    });
    expect(res.status).toBe(401);
  });
});
