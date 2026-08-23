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
 * Coarse, non-leaking classification of an unhandled error.
 *
 * The raw message is deliberately not returned: it carries provider payloads,
 * connection strings, and occasionally a key. The code is a hint that usually
 * identifies the fault from a screenshot alone; `error_id` is the part that
 * always works, because it appears verbatim in the log line beside the stack.
 *
 * Matching on message text is best-effort and will drift as upstream wording
 * changes. That is acceptable for a hint — an unrecognized error still gets an
 * id, and the id is what closes the loop.
 */
function classifyRouteError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("maximum input length") || text.includes("maximum context length")) {
    return "embedding_input_too_large";
  }
  if (text.includes("request openai embeddings")) return "embedding_request_failed";
  if (text.includes("turbopuffer")) return "vector_store_request_failed";
  if (text.includes("econnrefused") || text.includes("etimedout")) return "upstream_unreachable";
  if (text.includes("statement timeout") || text.includes("connection terminated")) {
    return "database_error";
  }
  return "internal_error";
}

/**
 * Log and shape unhandled route errors.
 *
 * Hono's default turns a throw into a bare `500 Internal Server Error` with
 * nothing recorded anywhere. That is how a NUL byte in one session transcript
 * stayed invisible through five client retries and an empty CloudWatch log
 * group: the only evidence anywhere was a status code. A 500 is a bug in this
 * service by definition, so the detail needed to find it gets written down.
 *
 * The body carries a code and an id as well, because the log line alone only
 * helps someone who already knows to go looking. What actually reaches a
 * maintainer is a user's screenshot of `gx review`, and the CLI prints this
 * body verbatim in the evidence line for the failed source. "internal server
 * error" in that screenshot cost a full CloudWatch expedition to learn that a
 * diff had overrun the embedding token limit; `embedding_input_too_large`
 * plus an id that greps straight to the stack would have cost one line.
 */
export function describeRouteError(err: unknown): {
  message: string;
  code: string;
  errorId: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  return {
    message,
    code: classifyRouteError(message),
    errorId: crypto.randomUUID().slice(0, 8),
  };
}

app.onError((err, c) => {
  const { message, code, errorId } = describeRouteError(err);
  console.error("unhandled route error", {
    error_id: errorId,
    code,
    method: c.req.method,
    path: c.req.path,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json({ error: "internal server error", code, error_id: errorId }, 500);
});

export default app;
