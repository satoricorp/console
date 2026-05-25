import { serve } from "@hono/node-server";
import app from "./app";

const port = Number(process.env.PORT ?? 3200);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`api listening on :${info.port}`);
  },
);
