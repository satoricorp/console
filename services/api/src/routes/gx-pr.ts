import { Hono } from "hono";
import { getSql } from "../db";
import type { AppEnv } from "../middleware/auth";
import { bearerToken, requireAuth } from "../middleware/auth";
import type { BookmarkSyncPayload, PushBundle } from "../types";
import { syncPushToConvex } from "../sync-convex-push";
import { deleteDevBookmark } from "../convex-client";
import { isEffectivelyEmptyBookmark } from "../bookmark-empty";
import {
  extractIndexFields,
  PayloadValidationError,
  validatePushBundle,
} from "../validate-payload";

export const gxPrRoutes = new Hono<AppEnv>();

gxPrRoutes.use("*", requireAuth);

function reviewUrl(eventId: string): string | undefined {
  const siteUrl = process.env.CONSOLE_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) {
    return undefined;
  }
  return `${siteUrl}/reviews/${eventId}`;
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

gxPrRoutes.post("/pr", async (c) => {
  let payload: PushBundle;
  try {
    const body = await c.req.json();
    payload = validatePushBundle(body);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const auth = c.get("auth");
  const cliToken = bearerToken(c.req.header("Authorization"));
  if (!cliToken) {
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
    const bookmarkIsEmpty = isEffectivelyEmptyBookmark(payload, {
      headCommitId: indexFields.head_commit_id,
      updatedAtMs: payload.created_at,
      branchName,
    });

    const ingestResult = await db.begin(async (tx) => {
      const [eventRow] = await tx<
        { id: string }[]
      >`
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
          ${tx.json(payload)}
        )
        RETURNING id
      `;

      if (bookmarkIsEmpty) {
        await tx`
          DELETE FROM gx_bookmarks
          WHERE user_id = ${auth.userId}
            AND repo_full_name = ${repoFullName}
            AND branch_name = ${branchName}
        `;
        return { eventId: eventRow.id, bookmark: null };
      }

      const [bookmarkRow] = await tx<
        {
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
        }[]
      >`
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
          ${auth.userId},
          ${repoFullName},
          ${branchName},
          ${inferredTitle},
          ${eventRow.id},
          ${indexFields.head_commit_id},
          ${indexFields.github_pr_url},
          ${githubPrNumber},
          ${payload.created_at},
          ${payload.created_at}
        )
        ON CONFLICT (user_id, repo_full_name, branch_name)
        DO UPDATE SET
          revision = gx_bookmarks.revision + 1,
          latest_event_id = EXCLUDED.latest_event_id,
          head_commit_id = EXCLUDED.head_commit_id,
          github_pr_url = EXCLUDED.github_pr_url,
          github_pr_number = EXCLUDED.github_pr_number,
          updated_at_ms = EXCLUDED.updated_at_ms,
          title = COALESCE(gx_bookmarks.title, EXCLUDED.title)
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

      const bookmark: BookmarkSyncPayload = {
        postgresBookmarkId: bookmarkRow.id,
        latestEventId: bookmarkRow.latest_event_id,
        repoFullName,
        branchName,
        title: bookmarkRow.title,
        revision: bookmarkRow.revision,
        mergeStatus: bookmarkRow.merge_status,
        githubPrUrl: bookmarkRow.github_pr_url,
        githubPrNumber: bookmarkRow.github_pr_number,
        headCommitId: bookmarkRow.head_commit_id,
        remoteHeadSha,
        updatedAt: Number(bookmarkRow.updated_at_ms),
        latestPayload: payload,
      };

      return { eventId: eventRow.id, bookmark };
    });

    if (ingestResult.bookmark) {
      try {
        await syncPushToConvex(cliToken, ingestResult.bookmark, auth);
      } catch (syncError) {
        console.error("Failed to sync gx.pr event to Convex", syncError);
        return c.json({ error: "Failed to sync event to console" }, 500);
      }
    } else {
      const devKey = process.env.GX_CLOUD_API_KEY?.trim();
      const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();
      try {
        if (devKey && cliToken === devKey && webhookSecret) {
          await deleteDevBookmark(webhookSecret, auth.userId, {
            repoFullName,
            branchName,
          });
        } else {
          const { deleteCliBookmark } = await import("../convex-client");
          await deleteCliBookmark(cliToken, repoFullName, branchName);
        }
      } catch (syncError) {
        console.warn("Failed to delete empty bookmark from Convex", syncError);
      }
    }

    const url = reviewUrl(ingestResult.eventId);
    return c.json({ id: ingestResult.eventId, ...(url ? { url } : {}) }, 201);
  } catch (error) {
    console.error("Failed to ingest gx.pr event", error);
    return c.json({ error: "Failed to store event" }, 500);
  }
});
