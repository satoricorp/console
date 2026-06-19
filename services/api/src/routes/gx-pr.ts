import { Hono } from "hono";
import { gunzipSync } from "node:zlib";
import type postgres from "postgres";
import { getSql } from "../db";
import type { AppEnv } from "../middleware/auth";
import { bearerToken, requireAuth } from "../middleware/auth";
import { createPayloadManifest, storeFullPayload } from "../gx-payload-store";
import type { PushBundle } from "../types";
import { FREE_FULL_STACK_REVIEW_LIMIT } from "./usage";
import {
  extractIndexFields,
  PayloadValidationError,
  validatePushBundle,
} from "../validate-payload";

export const gxPrRoutes = new Hono<AppEnv>();

gxPrRoutes.use("*", requireAuth);

function reviewUrl(prId: string): string | undefined {
  const siteUrl = process.env.CONSOLE_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) {
    return undefined;
  }
  return `${siteUrl}/reviews/${prId}`;
}

function parseGithubPrNumber(githubPrUrl: string | null): number | null {
  if (!githubPrUrl) return null;
  const match = githubPrUrl.match(/\/pull\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function repoFullNameFromRemoteUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function branchSlugTitle(branchName: string): string {
  const slug = branchName.split("/").at(-1) ?? branchName;
  const words = slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return branchName;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function inferBookmarkTitle(payload: PushBundle, branchName: string): string {
  const stack = payload.stack;
  if (Array.isArray(stack)) {
    for (const item of stack) {
      const change = item?.change;
      if (!change) continue;
      const firstLine = change.description?.split("\n")[0]?.trim();
      if (firstLine) return firstLine;
    }
  }

  const firstChangeLine = payload.change?.description?.split("\n")[0]?.trim();
  if (firstChangeLine) return firstChangeLine;

  return branchSlugTitle(branchName);
}

function isFullStackReview(payload: PushBundle): boolean {
  return Array.isArray(payload.stack) && payload.stack.length > 1;
}

type BookmarkRow = {
  id: string;
  latest_event_id: string;
  title: string | null;
  revision: number;
  merge_status: "open" | "merged" | "closed";
  github_pr_url: string | null;
  github_pr_number: number | null;
  head_commit_id: string | null;
  remote_head_sha: string | null;
  updated_at_ms: string;
};

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

async function upsertBookmark(
  tx: SqlExecutor,
  args: {
    userId: string;
    prId: string | null;
    repoFullName: string;
    branchName: string;
    inferredTitle: string;
    eventId: string;
    headCommitId: string;
    githubPrUrl: string | null;
    githubPrNumber: number | null;
    updatedAtMs: number;
  },
): Promise<BookmarkRow> {
  if (args.prId) {
    const [bookmarkRow] = await tx<BookmarkRow[]>`
      INSERT INTO gx_bookmarks (
        id,
        user_id,
        repo_full_name,
        branch_name,
        title,
        latest_event_id,
        head_commit_id,
        github_pr_url,
        github_pr_number,
        updated_at_ms,
        published_at_ms
      ) VALUES (
        ${args.prId},
        ${args.userId},
        ${args.repoFullName},
        ${args.branchName},
        ${args.inferredTitle},
        ${args.eventId},
        ${args.headCommitId},
        ${args.githubPrUrl},
        ${args.githubPrNumber},
        ${args.updatedAtMs},
        ${args.updatedAtMs}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        branch_name = EXCLUDED.branch_name,
        repo_full_name = EXCLUDED.repo_full_name,
        revision = gx_bookmarks.revision + 1,
        latest_event_id = EXCLUDED.latest_event_id,
        head_commit_id = EXCLUDED.head_commit_id,
        github_pr_url = COALESCE(EXCLUDED.github_pr_url, gx_bookmarks.github_pr_url),
        github_pr_number = COALESCE(EXCLUDED.github_pr_number, gx_bookmarks.github_pr_number),
        updated_at_ms = EXCLUDED.updated_at_ms,
        title = COALESCE(gx_bookmarks.title, EXCLUDED.title),
        merge_status = CASE
          WHEN gx_bookmarks.merge_status = 'closed' THEN 'open'
          ELSE gx_bookmarks.merge_status
        END,
        merged_at_ms = CASE
          WHEN gx_bookmarks.merge_status = 'closed' THEN NULL
          ELSE gx_bookmarks.merged_at_ms
        END
      RETURNING
        id,
        latest_event_id,
        title,
        revision,
        merge_status,
        github_pr_url,
        github_pr_number,
        head_commit_id,
        remote_head_sha,
        updated_at_ms
    `;
    return bookmarkRow;
  }

  const existing = await tx<{ id: string }[]>`
    SELECT id
    FROM gx_bookmarks
    WHERE user_id = ${args.userId}
      AND repo_full_name = ${args.repoFullName}
      AND branch_name = ${args.branchName}
    LIMIT 1
  `;

  if (existing[0]?.id) {
    const [bookmarkRow] = await tx<BookmarkRow[]>`
      UPDATE gx_bookmarks
      SET
        revision = revision + 1,
        latest_event_id = ${args.eventId},
        head_commit_id = ${args.headCommitId},
        github_pr_url = COALESCE(${args.githubPrUrl}, github_pr_url),
        github_pr_number = COALESCE(${args.githubPrNumber}, github_pr_number),
        updated_at_ms = ${args.updatedAtMs},
        title = COALESCE(title, ${args.inferredTitle}),
        merge_status = CASE
          WHEN merge_status = 'closed' THEN 'open'
          ELSE merge_status
        END,
        merged_at_ms = CASE
          WHEN merge_status = 'closed' THEN NULL
          ELSE merged_at_ms
        END
      WHERE id = ${existing[0].id}
      RETURNING
        id,
        latest_event_id,
        title,
        revision,
        merge_status,
        github_pr_url,
        github_pr_number,
        head_commit_id,
        remote_head_sha,
        updated_at_ms
    `;
    return bookmarkRow;
  }

  const [bookmarkRow] = await tx<BookmarkRow[]>`
    INSERT INTO gx_bookmarks (
      user_id,
      repo_full_name,
      branch_name,
      title,
      latest_event_id,
      head_commit_id,
      github_pr_url,
      github_pr_number,
      updated_at_ms,
      published_at_ms
    ) VALUES (
      ${args.userId},
      ${args.repoFullName},
      ${args.branchName},
      ${args.inferredTitle},
      ${args.eventId},
      ${args.headCommitId},
      ${args.githubPrUrl},
      ${args.githubPrNumber},
      ${args.updatedAtMs},
      ${args.updatedAtMs}
    )
    RETURNING
      id,
      latest_event_id,
      title,
      revision,
      merge_status,
      github_pr_url,
      github_pr_number,
      head_commit_id,
      remote_head_sha,
      updated_at_ms
  `;
  return bookmarkRow;
}

gxPrRoutes.post("/pr", async (c) => {
  let payload: PushBundle;
  try {
    let body: unknown;
    const encoding = c.req.header("Content-Encoding")?.toLowerCase() ?? "";
    if (encoding.includes("gzip")) {
      const compressed = new Uint8Array(await c.req.arrayBuffer());
      body = JSON.parse(new TextDecoder().decode(gunzipSync(compressed)));
    } else {
      body = await c.req.json();
    }
    payload = validatePushBundle(body);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const auth = c.get("auth");
  if (!bearerToken(c.req.header("Authorization"))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const indexFields = extractIndexFields(payload);
  const db = getSql();

  try {
    const repoFullName =
      repoFullNameFromRemoteUrl(indexFields.remote_url) ??
      `${auth.githubUserLogin}/${indexFields.repo_root_path.split("/").at(-1) ?? "repo"}`;
    const branchName =
      indexFields.branch_name ??
      payload.repo.branch_name ??
      payload.push.branch_name ??
      "unknown";
    const inferredTitle = inferBookmarkTitle(payload, branchName);
    const githubPrNumber = parseGithubPrNumber(indexFields.github_pr_url);
    const payloadManifest = createPayloadManifest(payload);
    const shouldCountFreeReview = isFullStackReview(payload);

    const ingestResult = await db.begin(async (tx) => {
      const [eventRow] = await tx<{ id: string }[]>`
        INSERT INTO gx_pr_events (
          event,
          created_at_ms,
          gx_version,
          user_id,
          session_id,
          machine_id,
          github_user_id,
          github_user_login,
          repo_root_path,
          repo_backend,
          remote_url,
          branch_name,
          head_commit_id,
          github_pr_url,
          payload
        ) VALUES (
          ${payload.event},
          ${payload.created_at},
          ${payload.gx_version},
          ${auth.userId},
          ${auth.sessionId},
          ${auth.machineId},
          ${auth.githubUserId},
          ${auth.githubUserLogin},
          ${indexFields.repo_root_path},
          ${indexFields.repo_backend},
          ${indexFields.remote_url},
          ${indexFields.branch_name},
          ${indexFields.head_commit_id},
          ${indexFields.github_pr_url},
          ${tx.json(payloadManifest)}
        )
        RETURNING id
      `;

      await storeFullPayload(tx, eventRow.id, payload);

      const bookmarkRow = await upsertBookmark(tx, {
        userId: auth.userId,
        prId: indexFields.pr_id,
        repoFullName,
        branchName,
        inferredTitle,
        eventId: eventRow.id,
        headCommitId: indexFields.head_commit_id,
        githubPrUrl: indexFields.github_pr_url,
        githubPrNumber,
        updatedAtMs: payload.created_at,
      });

      let fullStackReviewsUsed: number | undefined;
      if (shouldCountFreeReview) {
        await tx`
          INSERT INTO gx_review_usage (
            user_id,
            bookmark_id,
            first_event_id,
            counted_at_ms
          ) VALUES (
            ${auth.userId},
            ${bookmarkRow.id},
            ${eventRow.id},
            ${payload.created_at}
          )
          ON CONFLICT (user_id, bookmark_id) DO NOTHING
        `;

        const [usageRow] = await tx<{ count: string }[]>`
          SELECT COUNT(*)::TEXT AS count
          FROM gx_review_usage
          WHERE user_id = ${auth.userId}
        `;
        fullStackReviewsUsed = Number.parseInt(usageRow?.count ?? "0", 10);
      }

      let remoteHeadSha = bookmarkRow.remote_head_sha;
      const githubToken = process.env.GITHUB_TOKEN?.trim();
      if (githubToken) {
        try {
          const { getRemoteBranchSha } = await import("../github");
          remoteHeadSha = await getRemoteBranchSha(
            githubToken,
            repoFullName,
            branchName,
          );
          if (remoteHeadSha) {
            await tx`
              UPDATE gx_bookmarks
              SET remote_head_sha = ${remoteHeadSha}
              WHERE id = ${bookmarkRow.id}
            `;
          }
        } catch (shaError) {
          console.warn("Failed to resolve remote branch SHA during ingest", shaError);
        }
      }

      return {
        eventId: eventRow.id,
        prId: bookmarkRow.id,
        remoteHeadSha,
        fullStackReviewsUsed,
      };
    });

    const url = reviewUrl(ingestResult.prId);
    const freeReviewsRemaining =
      ingestResult.fullStackReviewsUsed === undefined
        ? undefined
        : Math.max(
            0,
            FREE_FULL_STACK_REVIEW_LIMIT - ingestResult.fullStackReviewsUsed,
          );
    return c.json(
      {
        id: ingestResult.prId,
        event_id: ingestResult.eventId,
        ...(freeReviewsRemaining !== undefined
          ? {
              free_review_limit: FREE_FULL_STACK_REVIEW_LIMIT,
              full_stack_reviews_used: ingestResult.fullStackReviewsUsed,
              free_reviews_remaining: freeReviewsRemaining,
            }
          : {}),
        ...(url ? { url } : {}),
      },
      201,
    );
  } catch (error) {
    console.error("Failed to ingest gx.pr event", error);
    return c.json({ error: "Failed to store event" }, 500);
  }
});
