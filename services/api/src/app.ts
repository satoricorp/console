import { Hono } from "hono";
import type { AppEnv } from "./middleware/auth";
import { eventsRoutes } from "./routes/events";
import { gxPrRoutes } from "./routes/gx-pr";
import { healthRoutes } from "./routes/health";

const app = new Hono<AppEnv>();

app.route("/", healthRoutes);
app.route("/gx", gxPrRoutes);
app.route("/events", eventsRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error("Unhandled error", error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
