import { Hono } from "hono";
import { githubWebhookRoutes } from "./github/webhook";
import type { AppEnv } from "./middleware/auth";
import { activityRoutes } from "./routes/activity";
import { authRoutes } from "./routes/auth";
import { reviewListRoutes } from "./routes/review-list";
import { healthRoutes } from "./routes/health";
import { ingestRoutes } from "./routes/ingest";
import { openAIRoutes } from "./routes/openai";
import { publishRoutes } from "./routes/publish";
import { reportedLogsRoutes } from "./routes/reported-logs";
import { reviewRoutes } from "./routes/review";
import { reviewHistoryRoutes } from "./routes/review-history";
import { reviewsRoutes } from "./routes/reviews";
import { summaryRoutes } from "./routes/summary";
import { indexRoutes } from "./routes/index-chunks";
import { watchRoutes } from "./routes/watch";

const app = new Hono<AppEnv>();

app.route("/", healthRoutes);
app.route("/", authRoutes);
app.route("/", ingestRoutes);
app.route("/", summaryRoutes);
app.route("/", reviewRoutes);
app.route("/", reviewHistoryRoutes);
app.route("/", reviewsRoutes);
app.route("/", activityRoutes);
app.route("/", reviewListRoutes);
app.route("/", publishRoutes);
app.route("/", reportedLogsRoutes);
app.route("/", indexRoutes);
app.route("/gx/openai", openAIRoutes);
app.route("/", githubWebhookRoutes);
app.route("/", watchRoutes);

export default app;
