import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
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

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
