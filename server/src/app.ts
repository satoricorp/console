import { Hono } from "hono";
import { githubWebhookRoutes } from "./github/webhook";
import type { AppEnv } from "./middleware/auth";
import { activityRoutes } from "./routes/activity";
import { authRoutes } from "./routes/auth";
import { bookmarksRoutes } from "./routes/bookmarks";
import { healthRoutes } from "./routes/health";
import { ingestRoutes } from "./routes/ingest";
import { openAIRoutes } from "./routes/openai";
import { publishRoutes } from "./routes/publish";
import { reportedLogsRoutes } from "./routes/reported-logs";
import { reviewRoutes } from "./routes/review";
import { reviewHistoryRoutes } from "./routes/review-history";
import { reviewsRoutes } from "./routes/reviews";
import { summaryRoutes } from "./routes/summary";

const app = new Hono<AppEnv>();

app.route("/", healthRoutes);
app.route("/", authRoutes);
app.route("/", ingestRoutes);
app.route("/", summaryRoutes);
app.route("/", reviewRoutes);
app.route("/", reviewHistoryRoutes);
app.route("/", reviewsRoutes);
app.route("/", activityRoutes);
app.route("/", bookmarksRoutes);
app.route("/", publishRoutes);
app.route("/", reportedLogsRoutes);
app.route("/gx/openai", openAIRoutes);
app.route("/", githubWebhookRoutes);

export default app;
