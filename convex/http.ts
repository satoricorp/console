import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

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
  path: "/turbo-puffer/should-index",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TURBO_PUFFER_CALLBACK_SECRET;
    if (!secret) {
      return new Response("Callback secret not configured", { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: { fullName?: string };
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body.fullName) {
      return new Response("Missing fullName", { status: 400 });
    }

    const job = await ctx.runQuery(internal.indexing.getJobByFullName, {
      fullName: body.fullName,
    });

    return Response.json({ shouldIndex: job !== null });
  }),
});

http.route({
  path: "/turbo-puffer/callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TURBO_PUFFER_CALLBACK_SECRET;
    if (!secret) {
      return new Response("Callback secret not configured", { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: {
      fullName: string;
      status: "pending" | "indexing" | "ready" | "failed";
      commitId?: string;
      filesTotal?: number;
      filesIndexed?: number;
      chunksIndexed?: number;
      error?: string;
      startedAt?: number;
      completedAt?: number;
      defaultBranch?: string;
    };

    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body.fullName || !body.status) {
      return new Response("Missing fullName or status", { status: 400 });
    }

    try {
      await ctx.runMutation(internal.indexing.updateJobStatus, {
        fullName: body.fullName,
        status: body.status,
        commitId: body.commitId,
        filesTotal: body.filesTotal,
        filesIndexed: body.filesIndexed,
        chunksIndexed: body.chunksIndexed,
        error: body.error,
        startedAt: body.startedAt,
        completedAt: body.completedAt,
        defaultBranch: body.defaultBranch,
      });
    } catch (error) {
      console.error("Turbo Puffer callback failed", error);
      return new Response("Callback error", { status: 500 });
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

export default http;
