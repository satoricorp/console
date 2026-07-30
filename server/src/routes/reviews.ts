import { Hono } from "hono";
import { syncBookmarkMergeStatusFromGithub } from "../bookmarks/merge-status";
import { getSql } from "../db";
import { requireAuth, type AppEnv } from "../middleware/auth";
import {
  enqueueReviewPlanGeneration,
  generateReviewPlan,
} from "../review-plan/generate";
import {
  filePatchIndex,
  loadReviewPlanContext,
} from "../review-plan/context";
import { sliceFilePatch } from "../review-plan/patch";
import type {
  NotablePatchSlice,
  ReviewActivityItem,
  ReviewBookmarkSummary,
  ReviewChangeSummary,
  ReviewPlan,
  ReviewResponse,
  UsageBreakdown,
} from "../review-plan/types";
import { isCurrentReviewPlan } from "../review-plan/validate";

export const reviewsRoutes = new Hono<AppEnv>();

reviewsRoutes.use("/v1/reviews/*", requireAuth);

type BookmarkAccessRow = {
  id: string;
  org_id: string;
  user_id: string;
  repo_full_name: string;
  branch_name: string;
  title: string | null;
  revision: number | string;
  head_commit_id: string | null;
  remote_head_sha: string | null;
  merge_status: string;
  github_pr_url: string | null;
  github_pr_number: number | null;
  published_at_ms: number | string;
  updated_at_ms: number | string;
  latest_event_id: string | null;
  app_base_branch: string | null;
  app_file_count: number | string | null;
  app_stack_count: number | string | null;
  app_token_count: number | string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadAccessibleBookmark(
  bookmarkId: string,
  auth: { userId: string; orgId: string },
): Promise<BookmarkAccessRow | null> {
  if (!uuidPattern.test(bookmarkId)) {
    return null;
  }
  const db = getSql();
  const [row] = await db<BookmarkAccessRow[]>`
    SELECT
      id, org_id, user_id, repo_full_name, branch_name, title, revision,
      head_commit_id, remote_head_sha, merge_status, github_pr_url, github_pr_number,
      published_at_ms, updated_at_ms, latest_event_id,
      app_base_branch, app_file_count, app_stack_count, app_token_count
    FROM bookmarks
    WHERE id = ${bookmarkId}::uuid
      AND (user_id = ${auth.userId} OR org_id = ${auth.orgId}::uuid)
    LIMIT 1
  `;
  return row ?? null;
}

reviewsRoutes.get("/v1/reviews/:bookmarkId", async (c) => {
  const auth = c.get("auth");
  const bookmarkId = c.req.param("bookmarkId");
  let bookmark = await loadAccessibleBookmark(bookmarkId, auth);
  if (!bookmark) {
    return c.json({ error: "Review not found" }, 404);
  }

  const db = getSql();
  bookmark = await syncBookmarkMergeStatusFromGithub(db, bookmark);
  const headCommitId = bookmark.head_commit_id ?? "";
  const response = await buildReviewResponse(db, bookmark, headCommitId);

  const planNeedsRefresh =
    response.plan.status === "ready" &&
    !isCurrentReviewPlan(response.plan.plan);

  // Auto-enqueue when the plan is missing, failed, or uses stale heuristics.
  if (
    (response.plan.status === "missing" ||
      response.plan.status === "failed" ||
      planNeedsRefresh) &&
    bookmark.latest_event_id &&
    headCommitId
  ) {
    enqueueReviewPlanGeneration(db, {
      orgId: bookmark.org_id,
      bookmarkId: bookmark.id,
      headCommitId,
      eventId: bookmark.latest_event_id,
    });
    if (response.plan.status === "missing" || planNeedsRefresh) {
      response.plan.status = "pending";
    }
  }

  return c.json(response);
});

reviewsRoutes.post("/v1/reviews/:bookmarkId/plan", async (c) => {
  const auth = c.get("auth");
  const bookmarkId = c.req.param("bookmarkId");
  const bookmark = await loadAccessibleBookmark(bookmarkId, auth);
  if (!bookmark) {
    return c.json({ error: "Review not found" }, 404);
  }
  if (!bookmark.head_commit_id || !bookmark.latest_event_id) {
    return c.json({ error: "No published artifact for this bookmark" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const db = getSql();
  const result = await generateReviewPlan(db, {
    orgId: bookmark.org_id,
    bookmarkId: bookmark.id,
    headCommitId: bookmark.head_commit_id,
    eventId: bookmark.latest_event_id,
    force: Boolean(body.force),
  });

  return c.json({
    status: result.status,
    planId: result.planId,
    model: result.model,
    provider: result.provider,
    error: result.error,
    latencyMs: result.latencyMs,
  });
});

async function buildReviewResponse(
  db: ReturnType<typeof getSql>,
  bookmark: BookmarkAccessRow,
  headCommitId: string,
): Promise<ReviewResponse> {
  const [planRow] = headCommitId
    ? await db<{
        id: string;
        status: string;
        plan: ReviewPlan | null;
        usage: UsageBreakdown | null;
        model: string | null;
        provider: string | null;
        error: string | null;
        head_commit_id: string;
        updated_at_ms: number | string;
      }[]>`
        SELECT id, status, plan, usage, model, provider, error, head_commit_id, updated_at_ms
        FROM review_plans
        WHERE bookmark_id = ${bookmark.id}::uuid
          AND head_commit_id = ${headCommitId}
        LIMIT 1
      `
    : [undefined];

  let stale = false;
  let effective = planRow;
  if (!effective) {
    const [newest] = await db<{
      id: string;
      status: string;
      plan: ReviewPlan | null;
      usage: UsageBreakdown | null;
      model: string | null;
      provider: string | null;
      error: string | null;
      head_commit_id: string;
      updated_at_ms: number | string;
    }[]>`
      SELECT id, status, plan, usage, model, provider, error, head_commit_id, updated_at_ms
      FROM review_plans
      WHERE bookmark_id = ${bookmark.id}::uuid
      ORDER BY updated_at_ms DESC
      LIMIT 1
    `;
    if (newest) {
      effective = newest;
      stale = newest.head_commit_id !== headCommitId;
    }
  }

  const ctx =
    bookmark.latest_event_id && headCommitId
      ? await loadReviewPlanContext(db, {
          orgId: bookmark.org_id,
          bookmarkId: bookmark.id,
          eventId: bookmark.latest_event_id,
          headCommitId,
        })
      : null;

  const changes: ReviewChangeSummary[] = (ctx?.revisions ?? []).map((rev) => ({
    changeId: rev.changeId,
    title: rev.description?.split("\n")[0]?.trim() || rev.changeId.slice(0, 12),
    description: rev.description,
    files: rev.files,
    patch: rev.patch,
    branchName: rev.branchName,
    baseBranchName: rev.baseBranchName,
  }));

  const notablePatches: NotablePatchSlice[] = [];
  if (effective?.plan && ctx) {
    const patches = filePatchIndex(ctx);
    for (const change of effective.plan.notableChanges) {
      const fp = patches.get(change.anchor.file);
      if (!fp) continue;
      notablePatches.push({
        rank: change.rank,
        file: change.anchor.file,
        revisionChangeId: change.anchor.revisionChangeId,
        patch: sliceFilePatch(fp, change.anchor.lineStart, change.anchor.lineEnd),
        lineStart: change.anchor.lineStart,
        lineEnd: change.anchor.lineEnd,
      });
    }
  }

  const [summary] = await db<{
    content: string;
    model: string | null;
    posted_at_ms: number | string;
  }[]>`
    SELECT content, model, posted_at_ms
    FROM summaries
    WHERE bookmark_id = ${bookmark.id}::uuid
    ORDER BY posted_at_ms DESC
    LIMIT 1
  `;

  const activity = await loadReviewActivity(db, bookmark, effective);

  const risk = ctx?.risk ?? null;
  const pushedBy = await loadPushedBy(db, bookmark.latest_event_id);

  const bookmarkSummary: ReviewBookmarkSummary = {
    id: bookmark.id,
    orgId: bookmark.org_id,
    userId: bookmark.user_id,
    repoFullName: bookmark.repo_full_name,
    branchName: bookmark.branch_name,
    title: bookmark.title,
    revision: Number(bookmark.revision),
    headCommitId: bookmark.head_commit_id,
    remoteHeadSha: bookmark.remote_head_sha,
    mergeStatus: bookmark.merge_status,
    githubPrUrl: bookmark.github_pr_url,
    githubPrNumber: bookmark.github_pr_number,
    publishedAtMs: Number(bookmark.published_at_ms),
    updatedAtMs: Number(bookmark.updated_at_ms),
    riskLevel: risk?.level ?? null,
    riskScore: typeof risk?.score === "number" ? risk.score : null,
    fileCount:
      Number(bookmark.app_file_count) ||
      ctx?.allFiles.length ||
      0,
    revisionCount:
      Number(bookmark.app_stack_count) ||
      changes.length ||
      1,
    pushedBy,
  };

  const planStatus = !effective
    ? "missing"
    : effective.status === "ready"
      ? "ready"
      : effective.status === "pending"
        ? "pending"
        : effective.status === "failed"
          ? "failed"
          : "missing";

  // Drop model-invented self-report quotes when the artifact has no verified
  // tx_commit self-report or first user prompt (common mislabel of the revision description).
  let planOut = effective?.plan ?? null;
  if (
    planOut?.narrative.selfReportQuote &&
    !ctx?.intent.selfReport?.taskSummary &&
    !(ctx?.intent.firstUserMessages?.length)
  ) {
    planOut = {
      ...planOut,
      narrative: {
        ...planOut.narrative,
        selfReportQuote: undefined,
      },
    };
  }

  return {
    bookmark: bookmarkSummary,
    plan: {
      status: planStatus,
      stale,
      plan: planOut,
      model: effective?.model ?? null,
      provider: effective?.provider ?? null,
      generatedAtMs: effective ? Number(effective.updated_at_ms) : null,
      error: effective?.error ?? null,
    },
    usage:
      effective?.usage?.totals?.totalTokens &&
      effective.usage.totals.totalTokens > 0
        ? effective.usage
        : ctx?.usage?.totals?.totalTokens && ctx.usage.totals.totalTokens > 0
          ? ctx.usage
          : null,
    changes,
    notablePatches,
    summary: summary
      ? {
          content: summary.content,
          model: summary.model,
          postedAtMs: Number(summary.posted_at_ms),
        }
      : null,
    activity,
    publishContext: {
      repoFullName: bookmark.repo_full_name,
      headBranch: bookmark.branch_name,
      baseBranch: ctx?.baseBranch || bookmark.app_base_branch || "main",
      localHeadSha: bookmark.head_commit_id,
      pullRequestNumber: bookmark.github_pr_number,
      pullRequestUrl: bookmark.github_pr_url,
    },
  };
}

async function loadPushedBy(
  db: ReturnType<typeof getSql>,
  eventId: string | null,
): Promise<string | null> {
  if (!eventId) return null;
  const [row] = await db<{ login: string | null }[]>`
    SELECT github_user_login AS login
    FROM pr_events
    WHERE id = ${eventId}::uuid
    LIMIT 1
  `;
  return row?.login ?? null;
}

async function loadReviewActivity(
  db: ReturnType<typeof getSql>,
  bookmark: BookmarkAccessRow,
  planRow:
    | {
        id: string;
        status: string;
        model: string | null;
        updated_at_ms: number | string;
      }
    | undefined,
): Promise<ReviewActivityItem[]> {
  const items: ReviewActivityItem[] = [];

  items.push({
    kind: "push",
    id: `push-${bookmark.id}`,
    atMs: Number(bookmark.published_at_ms),
    title: "Published to TX",
    detail: bookmark.head_commit_id?.slice(0, 12) ?? undefined,
  });

  if (planRow) {
    items.push({
      kind: "plan",
      id: planRow.id,
      atMs: Number(planRow.updated_at_ms),
      title:
        planRow.status === "ready"
          ? "Review plan generated"
          : planRow.status === "pending"
            ? "Review plan generating"
            : "Review plan failed",
      detail: planRow.model ?? undefined,
    });
  }

  const summaries = await db<{
    id: string;
    posted_at_ms: number | string;
    model: string | null;
  }[]>`
    SELECT id, posted_at_ms, model
    FROM summaries
    WHERE bookmark_id = ${bookmark.id}::uuid
    ORDER BY posted_at_ms DESC
    LIMIT 5
  `;
  for (const s of summaries) {
    items.push({
      kind: "summary",
      id: s.id,
      atMs: Number(s.posted_at_ms),
      title: "Summary posted",
      detail: s.model ?? undefined,
    });
  }

  const decisions = await db<{
    id: string;
    created_at_ms: number | string;
    action: string;
    reviewer: string;
  }[]>`
    SELECT id, created_at_ms, action, reviewer
    FROM decisions
    WHERE bookmark_id = ${bookmark.id}::uuid
    ORDER BY created_at_ms DESC
    LIMIT 10
  `;
  for (const d of decisions) {
    items.push({
      kind: "decision",
      id: d.id,
      atMs: Number(d.created_at_ms),
      title: `Decision: ${d.action}`,
      detail: d.reviewer,
    });
  }

  return items.sort((a, b) => b.atMs - a.atMs);
}
