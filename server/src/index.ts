import { serve } from "@hono/node-server";
import app from "./app";

const port = Number(process.env.PORT ?? 3201);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`gx-server listening on :${info.port}`);
  },
);
