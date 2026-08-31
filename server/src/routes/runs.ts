import { Hono } from "hono";
import { getSql } from "../db";
import {
  checkCloudAIQuota,
  paymentRequiredBody,
  TrialEntitlementUnavailableError,
} from "../metering/quota";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

export const runsRoutes = new Hono<AppEnv>();

runsRoutes.use("/v1/runs/*", requireAuth);

/**
 * The CLI's up-front check before a Cloud AI review: reserve the run now, so
 * a user with no runs left hears "subscribe at …" before any retrieval or
 * model work starts, rather than from the first model call mid-review. The
 * model proxies reserve under the same key, which is a no-op once this has
 * passed.
 */
runsRoutes.post("/v1/runs/reserve", async (c) => {
  const auth = c.get("auth");
  let body: { run_key?: string; kind?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json", message: "Body must be JSON" }, 400);
  }
  const runKey = body.run_key?.trim();
  if (!runKey) {
    return c.json({ error: "missing_run_key", message: "run_key is required" }, 400);
  }
  if (body.kind !== undefined && body.kind !== "review") {
    return c.json(
      { error: "invalid_kind", message: "kind must be review" },
      400,
    );
  }

  let quota;
  try {
    quota = await checkCloudAIQuota(getSql(), auth.orgId, auth.userId, runKey);
  } catch (error) {
    if (error instanceof TrialEntitlementUnavailableError) {
      return c.json(
        {
          error: "entitlement_unavailable",
          message: "gx entitlement service is unavailable. Please retry.",
        },
        503,
      );
    }
    throw error;
  }

  if (!quota.allowed) {
    return c.json(paymentRequiredBody(quota), 402);
  }

  return c.json({
    allowed: true,
    reason: quota.reason ?? "free_run",
    used: quota.used,
    limit: quota.limit,
    remaining: Math.max(quota.limit - quota.used, 0),
    checkout_url: quota.upgradeUrl,
  });
});
