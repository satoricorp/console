import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { repoFullNameFromPayload } from "./lib/gxPrPayload";

function repoFullNameFromBody(body: Record<string, unknown>): string | undefined {
  if (typeof body.repoFullName === "string") return body.repoFullName;
  if (typeof body.repo_full_name === "string") return body.repo_full_name;
  const fromArtifact = repoFullNameFromPayload(body);
  if (fromArtifact) return fromArtifact;
  const payload = body.payload ?? body.artifact;
  if (payload !== undefined) return repoFullNameFromPayload(payload);
  return undefined;
}

function sessionIdFromBody(body: Record<string, unknown>): string | undefined {
  if (typeof body.sessionId === "string") return body.sessionId;
  if (typeof body.session_id === "string") return body.session_id;
  return undefined;
}

function jsonError(message: string, status: number) {
  return new Response(message, { status });
}

function stringFromBody(
  body: Record<string, unknown>,
  camelName: string,
  snakeName: string,
): string | undefined {
  const camelValue = body[camelName];
  if (typeof camelValue === "string") return camelValue;
  const snakeValue = body[snakeName];
  if (typeof snakeValue === "string") return snakeValue;
  return undefined;
}

function numberFromBody(
  body: Record<string, unknown>,
  camelName: string,
  snakeName: string,
): number | undefined {
  const camelValue = body[camelName];
  if (typeof camelValue === "number" && Number.isFinite(camelValue)) {
    return camelValue;
  }
  const snakeValue = body[snakeName];
  if (typeof snakeValue === "number" && Number.isFinite(snakeValue)) {
    return snakeValue;
  }
  return undefined;
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

async function revokeCliAuth(ctx: ActionCtx, request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError("Unauthorized", 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return jsonError("Unauthorized", 401);
  }

  await ctx.runMutation(api.gxAuth.revokeCliToken, { token });
  return new Response(null, { status: 204 });
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
  handler: httpAction(completeCliAuth),
});

http.route({
  path: "/cx/auth/complete",
  method: "POST",
  handler: httpAction(completeCliAuth),
});

http.route({
  path: "/gx/auth/desktop/start",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    try {
      await request.json();
    } catch {
      return jsonError("Invalid JSON", 400);
    }

    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    if (!clientId) {
      return jsonError("Desktop OAuth is not configured", 503);
    }

    const origin = new URL(request.url).origin;
    const state = crypto.randomUUID();
    const authorizationURL = new URL("https://github.com/login/oauth/authorize");
    authorizationURL.searchParams.set("client_id", clientId);
    authorizationURL.searchParams.set(
      "redirect_uri",
      `${origin}/gx/auth/desktop/callback`,
    );
    authorizationURL.searchParams.set("scope", "repo");
    authorizationURL.searchParams.set("state", state);

    return Response.json({
      authorization_url: authorizationURL.toString(),
      state,
    });
  }),
});

http.route({
  path: "/gx/auth/desktop/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) {
      return jsonError("Missing code or state", 400);
    }

    try {
      const redirectUri = `${url.origin}/gx/auth/desktop/callback`;
      const result = await ctx.runAction(
        api.gxAuthActions.createDesktopOAuthTicketFromCode,
        {
          code,
          state,
          redirectUri,
        },
      );
      const handoffURL = `gx://auth?ticket=${encodeURIComponent(result.ticket)}&state=${encodeURIComponent(state)}`;
      return new Response(
        `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=${handoffURL}" />
    <title>GX sign in</title>
    <style>
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #050505; color: #fafafa; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
      a { color: #fafafa; }
    </style>
  </head>
  <body>
    <main>
      <p>Returning to GX...</p>
      <p><a href="${handoffURL}">Open GX</a></p>
    </main>
    <script>location.replace(${JSON.stringify(handoffURL)});</script>
  </body>
</html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Desktop OAuth failed";
      return jsonError(message, 401);
    }
  }),
});

http.route({
  path: "/gx/auth/desktop/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: {
      ticket?: string;
      state?: string;
      machine_id?: string;
      machine_name?: string;
      gx_version?: string;
    };

    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON", 400);
    }

    if (!body.ticket || !body.state || !body.machine_id || !body.machine_name) {
      return jsonError("Missing ticket, state, machine_id, or machine_name", 400);
    }

    try {
      const result = await ctx.runAction(api.gxAuthActions.completeDesktopOAuth, {
        ticket: body.ticket,
        state: body.state,
        machineId: body.machine_id,
        machineName: body.machine_name,
        gxVersion: body.gx_version,
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed";
      return jsonError(message, 401);
    }
  }),
});

http.route({
  path: "/gx/auth/revoke",
  method: "POST",
  handler: httpAction(revokeCliAuth),
});

http.route({
  path: "/cx/auth/revoke",
  method: "POST",
  handler: httpAction(revokeCliAuth),
});

http.route({
  path: "/gx/pr",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return jsonError("Unauthorized", 401);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const session = await ctx.runMutation(api.gxAuth.resolveCliToken, { token });
    const devSecret = process.env.GX_WEBHOOK_SECRET?.trim();
    let userId = session?.userId;
    const sessionId = session
      ? sessionIdFromBody(body) ?? session.sessionId
      : sessionIdFromBody(body);

    if (!userId && devSecret && token === devSecret) {
      const explicitUserId =
        typeof body.userId === "string"
          ? body.userId
          : typeof body.user_id === "string"
            ? body.user_id
            : undefined;
      if (explicitUserId) {
        userId = explicitUserId;
      } else {
        const repoFullName = repoFullNameFromBody(body);
        if (repoFullName) {
          userId =
            (await ctx.runQuery(internal.gxReviewArtifacts.findUserIdForRepo, {
              repoFullName,
            })) ?? undefined;
        }
      }
    }

    if (!userId) {
      return jsonError("Unauthorized", 401);
    }

    const artifact =
      body.artifact !== undefined && typeof body.artifact === "object"
        ? body.artifact
        : body.payload !== undefined && typeof body.payload === "object"
          ? body.payload
          : body;

    const id = await ctx.runMutation(internal.gxReviewArtifacts.ingest, {
      userId,
      sessionId,
      artifact,
    });

    const origin = new URL(request.url).origin;
    return Response.json({
      review_id: id,
      review_url: `${origin}/reviews/${id}`,
      index_status: "pending",
    });
  }),
});

http.route({
  path: "/gx/pr/comment",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return jsonError("Unauthorized", 401);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const session = await ctx.runMutation(api.gxAuth.resolveCliToken, { token });
    if (!session?.userId) {
      return jsonError("Unauthorized", 401);
    }

    const bodyMarkdown = stringFromBody(body, "body", "body_markdown")?.trim();
    if (!bodyMarkdown) {
      return jsonError("Missing comment body", 400);
    }

    const requestedScope = stringFromBody(body, "scope", "scope") || "pr";
    const scope = ["pr", "revision", "file", "line"].includes(requestedScope)
      ? (requestedScope as "pr" | "revision" | "file" | "line")
      : "pr";
    const authorLogin =
      stringFromBody(body, "authorLogin", "author_login") || session.githubLogin;
    const assigneeLogin =
      stringFromBody(body, "assigneeLogin", "assignee_login") || authorLogin;

    const id = await ctx.runMutation(internal.gxReviewArtifacts.addComment, {
      userId: session.userId,
      reviewId: stringFromBody(body, "reviewId", "review_id"),
      bookmarkId: stringFromBody(body, "bookmarkId", "bookmark_id"),
      repoFullName: repoFullNameFromBody(body),
      scope,
      bodyMarkdown,
      approvalPercent: numberFromBody(
        body,
        "approvalPercent",
        "approval_percent",
      ),
      authorLogin,
      assigneeLogin,
    });

    return Response.json({
      comment_id: id,
      status: "open",
    });
  }),
});

export default http;
