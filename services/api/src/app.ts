import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppEnv } from "./middleware/auth";
import { bookmarksRoutes } from "./routes/bookmarks";
import { eventsRoutes } from "./routes/events";
import { gxPrRoutes } from "./routes/gx-pr";
import { healthRoutes } from "./routes/health";
import { openAIRoutes } from "./routes/openai";
import { usageRoutes } from "./routes/usage";

const app = new Hono<AppEnv>();

app.use(logger());

app.route("/", healthRoutes);
app.route("/gx/openai", openAIRoutes);
app.route("/gx", gxPrRoutes);
app.route("/events", eventsRoutes);
app.route("/bookmarks", bookmarksRoutes);
app.route("/usage", usageRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error("Unhandled error", error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
