import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { requireServiceAuth } from "./auth";
import { ApplyError, applyBookmarkRevision } from "./apply";
import { closeDatabase } from "./db";
import { loadConfig } from "./config";
import type { ApplyRequest } from "./types";

const config = loadConfig();
const app = new Hono();

app.get("/health", (c) => {
  return c.json({ ok: true, service: "jj-worker" });
});

app.use("/apply", requireServiceAuth(config.serviceApiKey));

app.post("/apply", async (c) => {
  let body: ApplyRequest;
  try {
    body = await c.req.json<ApplyRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.bookmarkId || !body.userId || !Array.isArray(body.ops)) {
    return c.json(
      { error: "bookmarkId, userId, and ops[] are required" },
      400,
    );
  }

  try {
    const result = await applyBookmarkRevision(config, body);
    return c.json(result);
  } catch (error) {
    if (error instanceof ApplyError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    console.error("POST /apply failed", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error("Unhandled error", error);
  return c.json({ error: "Internal server error" }, 500);
});

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`jj-worker listening on :${info.port}`);
  },
);

async function shutdown() {
  await closeDatabase();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
