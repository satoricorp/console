import { Hono } from "hono";
import { pingDatabase } from "../db";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  try {
    await pingDatabase();
    return c.json({ ok: true, service: "gx-server" });
  } catch (error) {
    console.error("health check failed", error);
    return c.json({ ok: false, service: "gx-server" }, 503);
  }
});
