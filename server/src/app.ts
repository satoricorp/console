import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { githubWebhookRoutes } from "./github/webhook";
import type { AppEnv } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { bedrockRoutes } from "./routes/bedrock";
import { connectedReposRoutes } from "./routes/connected-repos";
import { reviewListRoutes } from "./routes/review-list";
import { healthRoutes } from "./routes/health";
import { ingestRoutes } from "./routes/ingest";
import { openAIRoutes } from "./routes/openai";
import { publishRoutes } from "./routes/publish";
import { reportedLogsRoutes } from "./routes/reported-logs";
import { reviewSearchRoutes } from "./routes/search";
import { reviewHistoryRoutes } from "./routes/review-history";
import { reviewsRoutes } from "./routes/reviews";

const app = new Hono<AppEnv>();

/**
 * Ceiling on any request body, rejected on the stream before it is buffered.
 *
 * Only /gx/bedrock/fight had a size check, and it ran after
 * `c.req.arrayBuffer()` had already materialised the whole body in process
 * memory — then `TextDecoder().decode()` roughly doubled it again before
 * JSON.parse. Every other route (publish, ingest, summary, index-chunks,
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
app.route("/", reviewSearchRoutes);
app.route("/", reviewHistoryRoutes);
app.route("/", connectedReposRoutes);
app.route("/", reviewsRoutes);
app.route("/", reviewListRoutes);
app.route("/", publishRoutes);
app.route("/", reportedLogsRoutes);
app.route("/gx/openai", openAIRoutes);
app.route("/gx/bedrock", bedrockRoutes);
app.route("/", githubWebhookRoutes);

/**
 * Log and shape unhandled route errors.
 *
 * Hono's default turns a throw into a bare `500 Internal Server Error` with
 * nothing recorded anywhere. That is how a NUL byte in one session transcript
 * stayed invisible through five client retries and an empty CloudWatch log
 * group: the only evidence anywhere was a status code. A 500 is a bug in this
 * service by definition, so the detail needed to find it gets written down.
 */
app.onError((err, c) => {
  console.error("unhandled route error", {
    method: c.req.method,
    path: c.req.path,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json({ error: "internal server error" }, 500);
});

export default app;
