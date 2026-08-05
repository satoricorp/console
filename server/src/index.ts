import { serve } from "@hono/node-server";
import app from "./app";
import { getSql } from "./db";
import { syncInstallationOrgsToConvex } from "./orgs/convex-sync";

const port = Number(process.env.PORT ?? 3201);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`gx-server listening on :${info.port}`);

    // Fire and forget: Convex cannot name an index namespace without this
    // mapping, and on a fresh deploy it has none. Failing the sync must not
    // stop the server from serving — webhook deliveries repair the mapping
    // too, just more slowly.
    void syncInstallationOrgsToConvex(getSql())
      .then((count) => {
        if (count > 0) {
          console.log(`synced ${count} installation -> org mapping(s) to Convex`);
        }
      })
      .catch((error) => {
        console.error("installation -> org sync failed", error);
      });
  },
);
