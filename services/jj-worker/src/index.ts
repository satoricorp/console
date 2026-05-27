import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { ApplyRequest } from "./types";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ ok: true, service: "jj-worker" });
});

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

  console.log("POST /apply stub", {
    bookmarkId: body.bookmarkId,
    userId: body.userId,
    opCount: body.ops.length,
    opTypes: body.ops.map((op) => op.type),
  });

  return c.json(
    {
      error: "Not implemented",
      message:
        "jj-worker apply is a stub; use gx pr to publish until server jj is wired",
    },
    501,
  );
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error("Unhandled error", error);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 3210);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`jj-worker listening on :${info.port}`);
  },
);
