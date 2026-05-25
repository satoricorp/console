import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

function repoFullNameFromBody(body: Record<string, unknown>): string | undefined {
  if (typeof body.repoFullName === "string") return body.repoFullName;
  const repo = body.repo;
  if (repo && typeof repo === "object") {
    const repoRecord = repo as Record<string, unknown>;
    if (typeof repoRecord.fullName === "string") return repoRecord.fullName;
    if (
      typeof repoRecord.owner === "string" &&
      typeof repoRecord.name === "string"
    ) {
      return `${repoRecord.owner}/${repoRecord.name}`;
    }
  }
  return undefined;
}

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    const payload = await request.text();

    try {
      await ctx.runAction(internal.stripeWebhookActions.processWebhook, {
        payload,
        signature,
      });
    } catch (error) {
      console.error("Stripe webhook failed", error);
      return new Response("Webhook error", { status: 400 });
    }

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return new Response("Missing x-hub-signature-256 header", { status: 400 });
    }

    const event = request.headers.get("x-github-event");
    if (!event) {
      return new Response("Missing x-github-event header", { status: 400 });
    }

    const payload = await request.text();

    try {
      await ctx.runAction(internal.indexingActions.handleGithubWebhook, {
        payload,
        signature,
        event,
      });
    } catch (error) {
      console.error("GitHub webhook failed", error);
      return new Response("Webhook error", { status: 400 });
    }

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/gx/auth/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: {
      github_access_token?: string;
      machine_id?: string;
      machine_name?: string;
      gx_version?: string;
    };

    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body.github_access_token || !body.machine_id || !body.machine_name) {
      return new Response(
        "Missing github_access_token, machine_id, or machine_name",
        { status: 400 },
      );
    }

    try {
      const result = await ctx.runAction(api.gxAuthActions.completeCliAuth, {
        githubAccessToken: body.github_access_token,
        machineId: body.machine_id,
        machineName: body.machine_name,
        gxVersion: body.gx_version,
      });
      return Response.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authentication failed";
      const status = message.includes("Sign in to the console") ? 403 : 401;
      return new Response(message, { status });
    }
  }),
});

http.route({
  path: "/gx/auth/revoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    await ctx.runMutation(api.gxAuth.revokeCliToken, { token });
    return new Response(null, { status: 204 });
  }),
});

http.route({
  path: "/gx/pr",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.GX_WEBHOOK_SECRET;
    const provided =
      request.headers.get("x-gx-webhook-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!secret || provided !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const sessionId =
      typeof body.sessionId === "string"
        ? body.sessionId
        : typeof body.session_id === "string"
          ? body.session_id
          : undefined;

    let userId =
      typeof body.userId === "string"
        ? body.userId
        : typeof body.user_id === "string"
          ? body.user_id
          : undefined;

    if (!userId) {
      const repoFullName = repoFullNameFromBody(body);
      if (repoFullName) {
        const resolvedUserId = await ctx.runQuery(
          internal.gxPrHttp.findUserIdForRepo,
          { repoFullName },
        );
        if (resolvedUserId) userId = resolvedUserId;
      }
    }

    if (!userId) {
      return new Response("Missing userId (or repo linked to a connected repo)", {
        status: 400,
      });
    }

    const payload =
      body.payload !== undefined && typeof body.payload === "object"
        ? body.payload
        : body;

    await ctx.runMutation(internal.gxPr.ingestPush, {
      userId,
      sessionId,
      payload,
    });

    return Response.json({ ok: true });
  }),
});

export default http;
