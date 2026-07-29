import { Hono, type Context } from "hono";
import type postgres from "postgres";
import { getSql } from "../db";
import {
  findInstalledRepository,
  resolveOrgIdForInstallation,
} from "../github/app";
import { indexPublishedArtifact } from "../indexing/turbopuffer";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { enqueueReviewPlanGeneration } from "../review-plan/generate";
import {
  loadPublishedSessionTexts,
  refreshBookmarkAppFields,
  upsertBookmark,
  type BookmarkRow,
  type SqlExecutor,
} from "../publish/bookmark";
import { reconcilePublishBookmarkWithPullRequest } from "../publish/reconcile";
import { publishRevisions } from "../publish/revisions";
import { postMissingPrSummaryAfterPublish } from "../publish/summary-post";
import { capture, Events } from "../telemetry/posthog";
import type { PublishRegistration, PushBundle } from "../types";

export const publishRoutes = new Hono<AppEnv>();

publishRoutes.use("/v1/publish", requireAuth);

publishRoutes.post("/v1/publish", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (isRecord(body) && body.event === "gx.pr") {
    return handleArtifactPublish(c, body);
  }
  return handlePublishRegistration(c, body);
});

async function handleArtifactPublish(c: Context<AppEnv>, body: unknown) {
  const auth = c.get("auth");
  let payload: PushBundle;
  try {
    payload = validatePublishPayload(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid publish payload";
    return c.json({ error: message }, 400);
  }

  const now = Date.now();
  const repoFullName = repoFullNameFromPayload(payload, auth.githubUserLogin);
  const branchName = inferPublishBranchName(payload);
  const githubPrUrl = payload.push.github_pull_request_url ?? null;
  const githubPrNumber = parseGithubPrNumber(githubPrUrl);
  const title = inferBookmarkTitle(payload, branchName);

  try {
    const db = getSql();
    const orgId = await resolvePublishOrgId(db, auth.orgId, repoFullName);
    const result = await db.begin(async (tx) => {
      const [event] = await tx<{ id: string }[]>`
        INSERT INTO pr_events (
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
          payload,
          org_id,
          schema_version
        ) VALUES (
          ${payload.event},
          ${payload.created_at || now},
          ${payload.gx_version},
          ${auth.userId},
          ${auth.sessionId ?? null},
          ${auth.machineId ?? null},
          ${auth.githubUserId ?? null},
          ${auth.githubUserLogin ?? null},
          ${payload.repo.root_path},
          ${payload.repo.backend},
          ${payload.repo.remote_url ?? null},
          ${branchName},
          ${payload.push.head_commit_id},
          ${githubPrUrl},
          ${tx.json(payload as postgres.JSONValue)},
          ${orgId},
          ${payload.schema_version ?? 1}
        )
        RETURNING id
      `;
      if (!event?.id) {
        throw new Error("Failed to insert publish event");
      }

      const bookmark = await upsertBookmark(tx, {
        orgId,
        userId: auth.userId,
        requestedId: validUuid(payload.pr_id) ? payload.pr_id! : null,
        repoFullName,
        branchName,
        title,
        eventId: event.id,
        headCommitId: payload.push.head_commit_id,
        githubPrUrl,
        githubPrNumber,
        remoteHeadSha: null,
        updatedAtMs: payload.created_at || now,
      });

      return { eventId: event.id, bookmark };
    });

    const indexResult = await indexPublishedArtifact({
      orgId,
      repoFullName: result.bookmark.repo_full_name,
      eventId: result.eventId,
      branchName: result.bookmark.branch_name,
      headSha: payload.push.head_commit_id,
      payload,
      // The bundle carries session metadata only; the transcripts arrived
      // separately through POST /v1/sessions. Loading them here is what makes
      // the indexed session chunks carry content instead of a header card.
      sessionTexts: await loadPublishedSessionTexts(db, orgId, payload),
    });
    if (indexResult.status === "failed") {
      console.info("GX artifact indexing failed", {
        orgId: auth.orgId,
        repoFullName: result.bookmark.repo_full_name,
        eventId: result.eventId,
        error: indexResult.error,
      });
    }

    // Plain `git push` + `gh pr create` publishes without a PR URL. Attach the
    // open PR (and steal PR ownership from any webhook-only bookmark) so
    // /reviews and PR summary both use the publisher's event-bearing row.
    const bookmark = await reconcilePublishBookmarkWithPullRequest(db, {
      orgId,
      bookmark: result.bookmark,
      githubPrUrl,
      githubPrNumber,
    });

    await refreshBookmarkAppFields(db, bookmark.id, payload);

    try {
      await postMissingPrSummaryAfterPublish(db, {
        orgId,
        userId: auth.userId,
        bookmark,
      });
    } catch (error) {
      console.error("PR Summary after publish failed", {
        orgId,
        bookmarkId: bookmark.id,
        error,
      });
    }

    try {
      if (bookmark.head_commit_id) {
        enqueueReviewPlanGeneration(db, {
          orgId,
          bookmarkId: bookmark.id,
          headCommitId: bookmark.head_commit_id,
          eventId: result.eventId,
        });
      }
    } catch (error) {
      console.error("Review plan enqueue after publish failed", {
        orgId,
        bookmarkId: bookmark.id,
        error,
      });
    }

    capturePublishArtifact(payload, bookmark, {
      orgId,
      eventId: result.eventId,
      indexStatus: indexResult.status,
    });

    const url = reviewUrl(bookmark.id);
    return c.json(
      {
        id: bookmark.id,
        event_id: result.eventId,
        review_id: bookmark.id,
        ...(url ? { url, review_url: url } : {}),
        index_status: indexResult.status,
        repo_full_name: bookmark.repo_full_name,
        branch_name: bookmark.branch_name,
        title: bookmark.title,
        revision: bookmark.revision,
        github_pr_url: bookmark.github_pr_url,
        github_pr_number: bookmark.github_pr_number,
        head_commit_id: bookmark.head_commit_id,
        remote_head_sha: bookmark.remote_head_sha,
      },
      201,
    );
  } catch (error) {
    console.error("Failed to publish GX payload", error);
    return c.json({ error: "Failed to publish" }, 500);
  }
}

async function handlePublishRegistration(c: Context<AppEnv>, body: unknown) {
  const auth = c.get("auth");
  let registration: PublishRegistration;
  try {
    registration = validatePublishRegistration(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid publish registration";
    return c.json({ error: message }, 400);
  }

  try {
    const db = getSql();
    const orgId = await resolvePublishOrgId(db, auth.orgId, registration.repo_full_name);
    const bookmark = await upsertBookmark(db, {
      orgId,
      userId: auth.userId,
      requestedId: null,
      repoFullName: registration.repo_full_name,
      branchName: registration.branch_name,
      title: registration.title || branchSlugTitle(registration.branch_name),
      eventId: null,
      headCommitId: registration.head_commit_id,
      githubPrUrl: registration.github_pr_url ?? null,
      githubPrNumber: parseGithubPrNumber(registration.github_pr_url ?? null),
      remoteHeadSha: registration.remote_head_sha ?? null,
      updatedAtMs: Date.now(),
    });

    capturePublishRegistration(registration, bookmark, orgId);

    return c.json(
      {
        id: bookmark.id,
        repo_full_name: bookmark.repo_full_name,
        branch_name: bookmark.branch_name,
        github_pr_url: bookmark.github_pr_url,
        github_pr_number: bookmark.github_pr_number,
        head_commit_id: bookmark.head_commit_id,
        remote_head_sha: bookmark.remote_head_sha,
      },
      201,
    );
  } catch (error) {
    console.error("Failed to register GX publish", error);
    return c.json({ error: "Failed to register publish" }, 500);
  }
}

function validatePublishPayload(value: unknown): PushBundle {
  if (!isRecord(value)) throw new Error("Body must be a JSON object");
  if (value.event !== "gx.pr") throw new Error("Unsupported event");
  if (typeof value.created_at !== "number" || !Number.isFinite(value.created_at)) {
    throw new Error("created_at is required");
  }
  if (typeof value.gx_version !== "string" || !value.gx_version.trim()) {
    throw new Error("gx_version is required");
  }
  if (!isRecord(value.repo)) throw new Error("repo is required");
  if (typeof value.repo.root_path !== "string" || !value.repo.root_path.trim()) {
    throw new Error("repo.root_path is required");
  }
  if (typeof value.repo.backend !== "string" || !value.repo.backend.trim()) {
    throw new Error("repo.backend is required");
  }
  if (!isRecord(value.push)) throw new Error("push is required");
  if (typeof value.push.head_commit_id !== "string" || !value.push.head_commit_id.trim()) {
    throw new Error("push.head_commit_id is required");
  }
  return value as PushBundle;
}

function validatePublishRegistration(value: unknown): PublishRegistration {
  if (!isRecord(value)) throw new Error("Body must be a JSON object");
  const repoFullName = stringValue(value.repo_full_name);
  const branchName = stringValue(value.branch_name);
  const headCommitId = stringValue(value.head_commit_id);
  if (!repoFullName) throw new Error("repo_full_name is required");
  if (!branchName) throw new Error("branch_name is required");
  if (!headCommitId) throw new Error("head_commit_id is required");
  return {
    repo_full_name: repoFullName,
    branch_name: branchName,
    title: stringValue(value.title) || undefined,
    head_commit_id: headCommitId,
    remote_head_sha: stringValue(value.remote_head_sha) || undefined,
    github_pr_url: stringValue(value.github_pr_url) || undefined,
  };
}

async function resolvePublishOrgId(
  db: SqlExecutor,
  fallbackOrgId: string,
  repoFullName: string,
): Promise<string> {
  const grant = await findInstalledRepository(db, repoFullName);
  if (!grant) {
    return fallbackOrgId;
  }
  return (await resolveOrgIdForInstallation(db, grant.installationId)) ?? fallbackOrgId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function repoFullNameFromPayload(payload: PushBundle, githubLogin?: string): string {
  const candidates = [
    payload.push.github_pull_request_url,
    payload.repo.remote_url,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const match = /github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#]|$)/i.exec(candidate);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }
  const repoName = payload.repo.root_path.split("/").filter(Boolean).at(-1) ?? "repo";
  return `${githubLogin || "unknown"}/${repoName}`;
}

function inferPublishBranchName(payload: PushBundle): string {
  const defaultBranch = payload.repo.default_branch?.trim() || "main";
  const pushBranch = payload.push.branch_name?.trim();
  const repoBranch = payload.repo.branch_name?.trim();

  for (const revision of publishRevisions(payload)) {
    const revisionBranch = revision.branch_name?.trim();
    if (revisionBranch && revisionBranch !== defaultBranch) {
      return revisionBranch;
    }
  }

  if (pushBranch && pushBranch !== defaultBranch) {
    return pushBranch;
  }
  if (repoBranch && repoBranch !== defaultBranch) {
    return repoBranch;
  }
  return pushBranch || repoBranch || "unknown";
}

function inferBookmarkTitle(payload: PushBundle, branchName: string): string {
  for (const revision of publishRevisions(payload)) {
    const title = revision.description?.split("\n")[0]?.trim();
    if (title) return title;
  }
  return branchSlugTitle(branchName);
}

function capturePublishArtifact(
  payload: PushBundle,
  bookmark: BookmarkRow,
  input: { orgId: string; eventId: string; indexStatus: string },
) {
  capture(
    Events.PublishArtifact,
    {
      bookmark_id: bookmark.id,
      event_id: input.eventId,
      repo: bookmark.repo_full_name,
      revision_count: publishRevisionCount(payload),
      stack_count: 1,
      session_count: payload.sessions?.length ?? 0,
      has_github_pr: bookmark.github_pr_number !== null,
      github_pr_number: bookmark.github_pr_number,
      index_status: input.indexStatus,
      gx_version: payload.gx_version,
      source: "artifact",
    },
    input.orgId,
  );
}

function capturePublishRegistration(
  registration: PublishRegistration,
  bookmark: BookmarkRow,
  orgId: string,
) {
  capture(
    Events.PublishRegistration,
    {
      bookmark_id: bookmark.id,
      repo: bookmark.repo_full_name,
      stack_count: 1,
      has_github_pr: bookmark.github_pr_number !== null,
      github_pr_number: bookmark.github_pr_number,
      has_remote_head_sha: Boolean(registration.remote_head_sha),
      source: "registration",
    },
    orgId,
  );
}

function publishRevisionCount(payload: PushBundle): number {
  return publishRevisions(payload).length;
}

function branchSlugTitle(branchName: string): string {
  const slug = branchName.split("/").at(-1) ?? branchName;
  return slug.replace(/[-_]+/g, " ").trim() || branchName;
}

function parseGithubPrNumber(githubPrUrl: string | null | undefined): number | null {
  if (!githubPrUrl) return null;
  const match = /\/pull\/(\d+)(?:\/|$)/.exec(githubPrUrl);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function reviewUrl(bookmarkId: string): string | undefined {
  const siteUrl = (process.env.GX_SITE_URL || process.env.CONSOLE_SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return siteUrl ? `${siteUrl}/reviews/${bookmarkId}` : undefined;
}

function validUuid(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
