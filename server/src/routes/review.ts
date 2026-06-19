import { Hono } from "hono";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { loadReviewContext } from "../review/context";

export const reviewRoutes = new Hono<AppEnv>();

reviewRoutes.use("/v1/review/*", requireAuth);

reviewRoutes.get("/v1/review/context", async (c) => {
  const auth = c.get("auth");
  const repoRoot = c.req.query("repoRoot")?.trim() ?? "";
  const base = c.req.query("base")?.trim() ?? "";
  const head = c.req.query("head")?.trim() ?? "";

  if (!repoRoot || !base || !head) {
    return c.json({ error: "repoRoot, base, and head are required" }, 400);
  }

  const db = getSql();
  const context = await loadReviewContext(db, auth.orgId, { repoRoot, base, head });
  return c.json(context);
});
