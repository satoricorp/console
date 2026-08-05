import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

function jsonError(message: string, status: number) {
  return new Response(message, { status });
}

async function completeCliAuth(ctx: ActionCtx, request: Request) {
  let body: {
    github_access_token?: string;
    machine_id?: string;
    machine_name?: string;
    gx_version?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  if (!body.github_access_token || !body.machine_id || !body.machine_name) {
    return jsonError("Missing github_access_token, machine_id, or machine_name", 400);
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
    const message = error instanceof Error ? error.message : "Authentication failed";
    return jsonError(message, 401);
  }
}

async function verifyCliAuth(ctx: ActionCtx, request: Request) {
  let body: {
    token?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  if (!body.token) {
    return jsonError("Missing token", 400);
  }

  try {
    const result = await ctx.runAction(api.gxAuthActions.verifyCliSession, {
      token: body.token,
    });
    if (!result) {
      return jsonError("Unauthorized", 401);
    }
    return Response.json({
      session_id: result.sessionId,
      user_id: result.userId,
      github_user_id: result.githubUserId,
      github_login: result.githubLogin,
      machine_id: result.machineId,
      machine_name: result.machineName,
      expires_at: result.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return jsonError(message, 401);
  }
}

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/cx/stripe/webhook",
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

// Bulk installation -> org upsert, called by the gx Cloud server.
//
// Deliveries keep the mapping current but cannot start it: on a fresh deploy
// the table is empty and nothing fills it until each installation emits an
// event, and until then no org resolves, so nothing indexes and console search
// returns nothing. Postgres is the source of truth, so this is a projection
// catching up rather than a migration.
http.route({
  path: "/cx/orgs/installations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.GX_CLOUD_API_KEY?.trim();
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    if (!expected || token !== expected) {
      return jsonError("Unauthorized", 401);
    }

    let body: {
      installations?: Array<{
        installationId?: number;
        orgId?: string;
        accountLogin?: string;
      }>;
    };
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON", 400);
    }

    let synced = 0;
    for (const entry of body.installations ?? []) {
      if (typeof entry.installationId !== "number" || !entry.orgId?.trim()) {
        continue;
      }
      await ctx.runMutation(internal.orgs.upsertInstallationOrg, {
        installationId: entry.installationId,
        orgId: entry.orgId.trim(),
        accountLogin: entry.accountLogin,
      });
      synced += 1;
    }

    return new Response(JSON.stringify({ synced }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/cx/github/webhook",
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
    // Set by the gx Cloud server when it forwards a delivery: Postgres owns
    // installation -> org, and re-deriving it here would let the two disagree.
    const orgId = request.headers.get("x-gx-org-id")?.trim() || undefined;

    try {
      await ctx.runAction(internal.indexingActions.handleGithubWebhook, {
        payload,
        signature,
        event,
        orgId,
      });
    } catch (error) {
      console.error("GitHub webhook failed", error);
      return new Response("Webhook error", { status: 400 });
    }

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/cx/auth/complete",
  method: "POST",
  handler: httpAction(completeCliAuth),
});

http.route({
  path: "/cx/auth/cli/verify",
  method: "POST",
  handler: httpAction(verifyCliAuth),
});

http.route({
  path: "/cx/trial/entitlement",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.GX_CLOUD_API_KEY?.trim();
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!expected || token !== expected) {
      return jsonError("Unauthorized", 401);
    }

    let body: { user_id?: string };
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON", 400);
    }

    const userId = body.user_id?.trim();
    if (!userId) {
      return jsonError("Missing user_id", 400);
    }

    const entitlement = await ctx.runQuery(
      internal.userAppState.getTrialEntitlement,
      { userId },
    );

    if (!entitlement) {
      return Response.json({ allowed: false, reason: "unknown_user" });
    }

    return Response.json(entitlement);
  }),
});

export default http;
