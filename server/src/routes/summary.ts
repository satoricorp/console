import { Hono } from "hono";
import { getSql } from "../db";
import { QuotaExceededError } from "../metering/quota";
import { generateSummary } from "../summary/generate";
import { requireAuth, type AppEnv } from "../middleware/auth";

export const summaryRoutes = new Hono<AppEnv>();

summaryRoutes.use("/v1/summaries/*", requireAuth);

summaryRoutes.post("/v1/summaries/generate", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as {
    bookmarkId?: string;
    eventId?: string;
  };

  if (!body.bookmarkId && !body.eventId) {
    return c.json({ error: "bookmarkId or eventId is required" }, 400);
  }

  try {
    const db = getSql();
    const result = await generateSummary(db, {
      orgId: auth.orgId,
      userId: auth.userId,
      bookmarkId: body.bookmarkId,
      eventId: body.eventId,
    });

    return c.json({
      summaryId: result.summaryId,
      bookmarkId: result.bookmarkId,
      eventId: result.eventId,
      lineCount: result.lineCount,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return c.json(
        {
          error: err.message,
          used: err.used,
          limit: err.limit,
          upgradeUrl: err.upgradeUrl,
          trialEndsAt: err.trialEndsAt ?? null,
        },
        402,
      );
    }
    const message = err instanceof Error ? err.message : "generation failed";
    if (
      message.includes("not found") ||
      message.includes("no bookmark linked") ||
      message.includes("does not match")
    ) {
      return c.json({ error: message }, 404);
    }
    if (message.includes("Invalid PR Summary")) {
      return c.json({ error: message }, 422);
    }
    return c.json({ error: message }, 500);
  }
});
