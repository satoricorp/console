import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { githubWebhookRoutes } from "./github/webhook";
import type { AppEnv } from "./middleware/auth";
import { activityRoutes } from "./routes/activity";
import { authRoutes } from "./routes/auth";
import { bedrockRoutes } from "./routes/bedrock";
import { connectedReposRoutes } from "./routes/connected-repos";
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

/**
 * Ceiling on any request body, rejected on the stream before it is buffered.
 *
 * Only /gx/bedrock/fight had a size check, and it ran after
 * `c.req.arrayBuffer()` had already materialised the whole body in process
 * memory — then `TextDecoder().decode()` roughly doubled it again before
 * JSON.parse. Every other route (publish, ingest, summary, watch, index-chunks,
 * review-history, reviews, reported-logs, and the unauthenticated GitHub
 * webhook) buffered with no check at all. A chunked body with no
 * Content-Length could therefore drive an ECS task past its 2048 MiB limit and
 * get it OOM-killed; with desiredCount 2, two concurrent requests take the API
 * down. This bounds the allocation instead of trusting the caller.
 *
 * 24 MB clears the largest legitimate body by a wide margin — publish bundles
 * cap a single commit patch at 512 KB — while staying far below the task's
 * memory. Routes keep their own tighter caps.
 */
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

app.use(
  "*",
  bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: (c) => c.json({ error: "request body too large" }, 413),
  }),
);

app.route("/", healthRoutes);
app.route("/", authRoutes);
app.route("/", ingestRoutes);
app.route("/", summaryRoutes);
app.route("/", reviewRoutes);
app.route("/", reviewHistoryRoutes);
app.route("/", connectedReposRoutes);
app.route("/", reviewsRoutes);
app.route("/", activityRoutes);
app.route("/", reviewListRoutes);
app.route("/", publishRoutes);
app.route("/", reportedLogsRoutes);
app.route("/", indexRoutes);
app.route("/gx/openai", openAIRoutes);
app.route("/gx/bedrock", bedrockRoutes);
app.route("/", githubWebhookRoutes);
app.route("/", watchRoutes);

export default app;
