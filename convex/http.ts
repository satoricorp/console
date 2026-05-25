import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return null;
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

function optionalBodyString(body: JsonRecord, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function buildRequestId(body: JsonRecord) {
  const repo = isRecord(body.repo) ? body.repo : {};
  const push = isRecord(body.push) ? body.push : {};
  const remoteUrl = optionalString(repo.remote_url) ?? optionalString(repo.root_path);
  const headCommitId = optionalString(push.head_commit_id);
  const createdAt = typeof body.created_at === "number" ? body.created_at : 0;
  return [
    optionalString(push.github_pull_request_url),
    remoteUrl && headCommitId ? `${remoteUrl}:${headCommitId}` : undefined,
    `${remoteUrl ?? "unknown"}:${createdAt}`,
  ].find((value): value is string => Boolean(value))!;
}

function changeFields(change: unknown) {
  const row = isRecord(change) ? change : {};
  return {
    changeId: optionalString(row.id),
    jjChangeId: optionalString(row.jj_change_id),
    currentCommitId: optionalString(row.current_commit_id),
    description: optionalString(row.description),
    status: optionalString(row.status),
    files: optionalStringArray(row.files),
  };
}

function normalizeGxPrPayload(body: unknown, userId: string) {
  if (!isRecord(body)) {
    return { error: "Invalid JSON payload" as const };
  }

  if (body.event !== "gx.pr") {
    return { error: "Expected event gx.pr" as const };
  }

  if (typeof body.created_at !== "number") {
    return { error: "Missing created_at" as const };
  }

  const repo = isRecord(body.repo) ? body.repo : {};
  const push = isRecord(body.push) ? body.push : {};
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const stack = Array.isArray(body.stack) ? body.stack : [];
  const debugJson = JSON.stringify(body, null, 2);

  const adds =
    stack.length > 0
      ? stack.filter(isRecord).map((entry, index) => {
          const change = changeFields(entry.change);
          return {
            order: index,
            ...change,
            branchName: optionalString(entry.branch_name),
            baseBranchName: optionalString(entry.base_branch_name),
            githubPullRequestUrl: optionalString(entry.github_pull_request_url),
            patch: optionalString(entry.patch),
            debugJson: JSON.stringify(entry, null, 2),
          };
        })
      : [
          {
            order: 0,
            ...changeFields(body.change),
            branchName: optionalString(repo.branch_name),
            baseBranchName: undefined,
            githubPullRequestUrl: optionalString(push.github_pull_request_url),
            patch: undefined,
            debugJson,
          },
        ];

  const firstAdd = adds[0];

  return {
    value: {
      userId,
      requestId: buildRequestId(body),
      event: "gx.pr",
      createdAt: body.created_at,
      gxVersion: optionalString(body.gx_version),
      repoRootPath: optionalString(repo.root_path),
      repoBackend: optionalString(repo.backend),
      repoRemoteUrl: optionalString(repo.remote_url),
      repoBranchName: optionalString(repo.branch_name),
      headCommitId: optionalString(push.head_commit_id),
      githubPullRequestUrl: optionalString(push.github_pull_request_url),
      title:
        optionalString(metadata.pr_title) ??
        optionalString(metadata.title) ??
        firstAdd?.description,
      description: firstAdd?.description,
      status: firstAdd?.status,
      debugJson,
      adds,
    },
  };
}

http.route({
  path: "/gx/auth/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!isRecord(body)) {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const githubAccessToken = optionalBodyString(body, "github_access_token");
    const machineId = optionalBodyString(body, "machine_id");
    const machineName = optionalBodyString(body, "machine_name");
    if (!githubAccessToken || !machineId || !machineName) {
      return new Response("Missing github_access_token, machine_id, or machine_name", {
        status: 400,
      });
    }

    try {
      const result = await ctx.runAction(api.gxAuthActions.completeCliAuth, {
        githubAccessToken,
        machineId,
        machineName,
        gxVersion: optionalString(body.gx_version),
      });
      return Response.json(result);
    } catch (error) {
      console.error("GX auth complete failed", error);
      return new Response("GX auth complete failed", { status: 500 });
    }
  }),
});

http.route({
  path: "/gx/auth/revoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = readBearerToken(request);
    if (!token) {
      return new Response("Missing bearer token", { status: 401 });
    }

    const result = await ctx.runMutation(internal.gxAuth.revokeCliToken, {
      token,
    });
    return Response.json(result);
  }),
});

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
  path: "/gx/pr",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = readBearerToken(request);
    if (!token) {
      return new Response("Missing bearer token", { status: 401 });
    }

    const auth = await ctx.runMutation(internal.gxAuth.resolveCliToken, {
      token,
    });
    if (!auth) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const normalized = normalizeGxPrPayload(body, auth.userId);
    if ("error" in normalized) {
      return new Response(normalized.error, { status: 400 });
    }

    try {
      const result = await ctx.runMutation(
        internal.gxPullRequests.upsertFromPr,
        normalized.value,
      );
      const siteUrl = process.env.SITE_URL?.replace(/\/$/, "");
      return Response.json(
        {
          id: result.id,
          url: siteUrl ? `${siteUrl}/reviews/${result.id}` : undefined,
          inserted: result.inserted,
        },
        { status: result.inserted ? 201 : 200 },
      );
    } catch (error) {
      console.error("GX PR ingest failed", error);
      return new Response("GX PR ingest failed", { status: 500 });
    }
  }),
});

export default http;
