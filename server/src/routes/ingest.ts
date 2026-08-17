import { Hono } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import { resolveHunkFileLines } from "../ingest/parse-hunk";
import { promoteSessionRaw } from "../ingest/promote";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { capture, Events } from "../telemetry/posthog";
import type { ExtractBody, SessionBody } from "../types";

export const ingestRoutes = new Hono<AppEnv>();

ingestRoutes.use("/v1/*", requireAuth);

ingestRoutes.post("/v1/extracts", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as ExtractBody;

  if (!body.repoRoot || !body.refRange || !body.headCommit) {
    return c.json({ error: "repoRoot, refRange, and headCommit are required" }, 400);
  }
  if (!Array.isArray(body.hunkLinks)) {
    return c.json({ error: "hunkLinks must be an array" }, 400);
  }

  const db = getSql();
  const now = Date.now();
  const gxVersion = body.gxVersion ?? "0.0.0-dev";

  const [event] = await db<{ id: string }[]>`
    INSERT INTO pr_events (
      created_at_ms, gx_version, head_commit_id, payload, org_id, user_id, repo_root_path
    ) VALUES (
      ${now},
      ${gxVersion},
      ${body.headCommit},
      ${db.json({
        refRange: body.refRange,
        intentCandidates: body.intentCandidates ?? [],
        struggleSignals: body.struggleSignals ?? [],
        humanOverrides: body.humanOverrides ?? [],
        fileStats: body.fileStats ?? null,
        toolVersions: body.toolVersions ?? {},
      } as postgres.JSONValue)},
      ${auth.orgId},
      ${auth.userId},
      ${body.repoRoot}
    )
    RETURNING id
  `;

  const eventId = event.id;
  let linksInserted = 0;

  for (const link of body.hunkLinks) {
    const { file, lineStart, lineEnd } = resolveHunkFileLines(link);
    await db`
      INSERT INTO hunk_links (
        org_id, event_id, file, line_start, line_end,
        session_id, match_tier, confidence, authorship, tool, model
      ) VALUES (
        ${auth.orgId},
        ${eventId},
        ${file},
        ${lineStart},
        ${lineEnd},
        ${link.sessionID ?? ""},
        ${link.tier},
        ${link.confidence},
        ${link.authorship},
        ${link.tool ?? null},
        ${link.model ?? null}
      )
    `;
    linksInserted++;
  }

  capture(
    Events.IngestExtract,
    {
      event_id: eventId,
      hunk_links_inserted: linksInserted,
      repo_root: body.repoRoot,
      ref_range: body.refRange,
      head_commit: body.headCommit,
    },
    auth.orgId,
  );

  return c.json({
    eventId,
    hunkLinksInserted: linksInserted,
  });
});

ingestRoutes.post("/v1/sessions", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as SessionBody;

  if (!body.sessionId || !body.tool || !body.content) {
    return c.json({ error: "sessionId, tool, and content are required" }, 400);
  }

  const db = getSql();
  const capturedAt = body.capturedAtMs ?? Date.now();

  const [row] = await db<{
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
      ${auth.orgId},
      ${body.sessionId},
      ${body.tool},
      ${body.model ?? null},
      ${body.content},
      ${capturedAt}
    )
    RETURNING id, org_id, session_id, tool, model, content, captured_at_ms
  `;

  const promotion = await promoteSessionRaw(db, row);

  capture(
    Events.IngestSession,
    {
      session_raw_id: row.id,
      session_id: row.session_id,
      tool: row.tool,
      model: row.model,
      bytes: row.content.length,
      events_promoted: promotion.promoted,
    },
    auth.orgId,
  );

  return c.json({
    sessionRawId: row.id,
    promotionStatus: promotion.skipped ? "skipped" : "done",
    eventsPromoted: promotion.promoted,
  });
});
