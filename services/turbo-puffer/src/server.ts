import { verifyServiceAuth, readJson } from "./verify-service-auth";
import { scheduleIndexRepo, type IndexRepoRequest } from "./index-repo";
import {
  queryReviewContext,
  type QueryReviewContextRequest,
} from "./query-review-context";
import { handleGithubPush } from "./handle-github-push";

const port = Number(process.env.PORT ?? 3100);

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/webhooks/github") {
      return handleGithubPush(request);
    }

    if (request.method === "POST" && url.pathname === "/index-repo") {
      const authError = verifyServiceAuth(request);
      if (authError) return authError;

      const body = await readJson<IndexRepoRequest>(request);
      if (!body.fullName || !body.githubId || !body.trigger) {
        return new Response("Missing fullName, githubId, or trigger", {
          status: 400,
        });
      }

      scheduleIndexRepo(body);

      return Response.json({ enqueued: true, fullName: body.fullName }, {
        status: 202,
      });
    }

    if (request.method === "POST" && url.pathname === "/query-review-context") {
      const authError = verifyServiceAuth(request);
      if (authError) return authError;

      const body = await readJson<QueryReviewContextRequest>(request);
      if (!body.fullName) {
        return new Response("Missing fullName", { status: 400 });
      }

      try {
        const results = await queryReviewContext(body);
        return Response.json(results);
      } catch (error) {
        console.error("query-review-context failed", error);
        return new Response(
          error instanceof Error ? error.message : "Search failed",
          { status: 500 },
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`turbo-puffer service listening on :${server.port}`);
