import { Hono } from "hono";
import { pingDatabase } from "../db";
import type { AppEnv } from "../middleware/auth";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/health", async (c) => {
  try {
    await pingDatabase();
    return c.json({ ok: true, db: "connected" });
  } catch {
    return c.json({ ok: false, db: "disconnected" }, 503);
  }
});
