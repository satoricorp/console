import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
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

export default http;
