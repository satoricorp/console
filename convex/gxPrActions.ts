"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import postgres from "postgres";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { authComponent } from "./auth";
import {
  getGithubAccessToken,
  verifyGithubRepoAccessWithToken,
} from "./githubAccess";
import {
  activePullFromResolution,
  getCheckStatusForRef,
  getPullRequest,
  createDraftPullRequest,
  getPullStatusForPush,
  mergePullRequestOnGithub,
  type PullStatusResponse,
  type PullStatusSnapshot,
  reconcilePullRequest,
  resolvePullForPush,
} from "./lib/gxPrGithub";
import { githubAdapter } from "./lib/codeStorageAdapter";
import { headCommitIdFromPayload, mergeTargetFromPayload } from "./lib/gxPrPayload";
import type { Id } from "./_generated/dataModel";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}

type MergeContext = {
  userId: string;
  payload: unknown;
  accessToken: string;
  target: NonNullable<ReturnType<typeof mergeTargetFromPayload>>;
  resolution: Awaited<ReturnType<typeof resolvePullForPush>>;
};

async function loadAuthorizedPushContext(
  ctx: ActionCtx,
  pushId: Id<"gxPrPushes">,
): Promise<MergeContext> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Sign in with GitHub to manage pull requests.");
  }

  const push = await ctx.runQuery(internal.gxPr.getPushForMerge, {
    pushId,
    userId: user._id,
  });
  if (!push) {
    throw new Error("Push not found.");
  }

  const target = mergeTargetFromPayload(push.payload, push.repoFullName);
  if (!target) {
    throw new Error("This push is missing repo or branch metadata required for GitHub.");
  }

  const accessToken = await getGithubAccessToken(ctx, user._id);
  const access = await verifyGithubRepoAccessWithToken(
    accessToken,
    target.repoFullName,
  );
  if (!access.ok) {
    throw new Error(access.message);
  }

  const resolution = await resolvePullForPush(
    accessToken,
    target.repoFullName,
    target.pullRequestNumber,
    target.headBranch,
    target.baseBranch,
  );

  return {
    userId: user._id,
    payload: push.payload,
    accessToken,
    target,
    resolution,
  };
}

async function loadAuthorizedBookmarkContext(
  ctx: ActionCtx,
  bookmarkId: string,
): Promise<MergeContext> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Sign in with GitHub to manage pull requests.");
  }

  const fromConvex = await ctx.runQuery(internal.gxPr.getBookmarkWithPayload, {
    userId: user._id,
    postgresBookmarkId: bookmarkId,
  });
  if (fromConvex?.payload) {
    const target = mergeTargetFromPayload(fromConvex.payload, fromConvex.repoFullName);
    if (!target) {
      throw new Error(
        "This bookmark is missing repo or branch metadata required for GitHub.",
      );
    }

    const accessToken = await getGithubAccessToken(ctx, user._id);
    const access = await verifyGithubRepoAccessWithToken(
      accessToken,
      target.repoFullName,
    );
    if (!access.ok) {
      throw new Error(access.message);
    }

    const resolution = await resolvePullForPush(
      accessToken,
      target.repoFullName,
      target.pullRequestNumber,
      target.headBranch,
      target.baseBranch,
    );

    return {
      userId: user._id,
      payload: fromConvex.payload,
      accessToken,
      target,
      resolution,
    };
  }

  const sql = getSql();
  try {
    const rows = await sql<
      {
        repo_full_name: string;
        payload: unknown;
      }[]
    >`
      SELECT
        b.repo_full_name,
        e.payload
      FROM gx_bookmarks b
      LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
      WHERE b.id = ${bookmarkId}
        AND b.user_id = ${user._id}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Bookmark not found.");
    }
    if (!row.payload) {
      throw new Error("Bookmark payload not found.");
    }

    const target = mergeTargetFromPayload(row.payload, row.repo_full_name);
    if (!target) {
      throw new Error(
        "This bookmark is missing repo or branch metadata required for GitHub.",
      );
    }

    const accessToken = await getGithubAccessToken(ctx, user._id);
    const access = await verifyGithubRepoAccessWithToken(
      accessToken,
      target.repoFullName,
    );
    if (!access.ok) {
      throw new Error(access.message);
    }

    const resolution = await resolvePullForPush(
      accessToken,
      target.repoFullName,
      target.pullRequestNumber,
      target.headBranch,
      target.baseBranch,
    );

    return {
      userId: user._id,
      payload: row.payload,
      accessToken,
      target,
      resolution,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const updateBookmarkMergeStatusRef = makeFunctionReference<
  "mutation",
  {
    userId: string;
    repoFullName: string;
    branchName: string;
    mergeStatus: "open" | "merged" | "closed";
    remoteHeadSha?: string;
  },
  null
>("gxPr:updateBookmarkMergeStatusByBranch");

async function maybeMarkBookmarkMerged(
  ctx: ActionCtx,
  userId: string,
  repoFullName: string,
  branchName: string,
  remoteHeadSha?: string,
) {
  await ctx.runMutation(updateBookmarkMergeStatusRef, {
    userId,
    repoFullName,
    branchName,
    mergeStatus: "merged",
    remoteHeadSha,
  });
}

function mergedSnapshotFromPull(
  pull: Awaited<ReturnType<typeof getPullRequest>>,
  checkStatus: Awaited<ReturnType<typeof getCheckStatusForRef>>,
): PullStatusSnapshot {
  return {
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.html_url,
    health: "merged",
    label: "Merged",
    canReconcile: false,
    isDraft: pull.draft,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state ?? null,
    mergeStateStatus: null,
    headSha: pull.head.sha,
    baseBranch: pull.base.ref,
    headBranch: pull.head.ref,
    checkStatus,
  };
}

async function buildPullStatusResponse(
  accessToken: string,
  target: { repoFullName: string; headBranch: string; baseBranch: string },
  localHeadSha: string | null,
  resolution: Awaited<ReturnType<typeof resolvePullForPush>>,
) {
  const statusResponse = await getPullStatusForPush(accessToken, resolution);
  const adapterStatus = await githubAdapter.fetchStatus({
    accessToken,
    repoFullName: target.repoFullName,
    headBranch: target.headBranch,
    baseBranch: target.baseBranch,
    localHeadSha,
  });

  if (!statusResponse.status) {
    return {
      ...statusResponse,
      message: adapterStatus.message ?? statusResponse.message,
    };
  }

  return {
    ...statusResponse,
    message: adapterStatus.message ?? statusResponse.message,
    status: {
      ...statusResponse.status,
      localHeadSha,
      remoteHeadSha: adapterStatus.remoteHeadSha,
      driftStatus: adapterStatus.driftStatus,
      checkStatus: adapterStatus.checkStatus,
    },
  };
}

async function loadAuthorizedMergeContext(
  ctx: ActionCtx,
  {
    pushId,
    bookmarkId,
  }: {
    pushId?: Id<"gxPrPushes">;
    bookmarkId?: string;
  },
): Promise<MergeContext> {
  if (pushId) {
    return loadAuthorizedPushContext(ctx, pushId);
  }
  if (bookmarkId) {
    return loadAuthorizedBookmarkContext(ctx, bookmarkId);
  }
  throw new Error("pushId or bookmarkId is required.");
}

export const getPullRequestStatus = action({
  args: {
    pushId: v.optional(v.id("gxPrPushes")),
    bookmarkId: v.optional(v.string()),
  },
  handler: async (ctx, { pushId, bookmarkId }) => {
    const { userId, payload, accessToken, target, resolution } =
      await loadAuthorizedMergeContext(ctx, {
        pushId,
        bookmarkId,
      });
    const localHeadSha = headCommitIdFromPayload(payload);
    let response = await buildPullStatusResponse(
      accessToken,
      target,
      localHeadSha,
      resolution,
    );

    if (target.pullRequestNumber != null) {
      try {
        const pull = await getPullRequest(
          accessToken,
          target.repoFullName,
          target.pullRequestNumber,
        );
        if (pull.merged) {
          const checkStatus = await getCheckStatusForRef(
            accessToken,
            target.repoFullName,
            pull.head.sha,
          );
          await maybeMarkBookmarkMerged(
            ctx,
            userId,
            target.repoFullName,
            target.headBranch,
            pull.head.sha,
          );
          response = {
            ...response,
            message: `PR #${pull.number} was merged on GitHub.`,
            status: {
              ...mergedSnapshotFromPull(pull, checkStatus),
              localHeadSha,
              remoteHeadSha: pull.head.sha,
              driftStatus: "in_sync",
            },
          };
        }
      } catch {
        // Keep standard status if merged-state lookup fails.
      }
    }

    return response;
  },
});

export const createPullRequestForPush = action({
  args: {
    pushId: v.optional(v.id("gxPrPushes")),
    bookmarkId: v.optional(v.string()),
  },
  handler: async (ctx, { pushId, bookmarkId }) => {
    const { payload, accessToken, target, resolution } =
      await loadAuthorizedMergeContext(ctx, {
        pushId,
        bookmarkId,
      });
    const localHeadSha = headCommitIdFromPayload(payload);

    if (resolution.kind === "direct") {
      return buildPullStatusResponse(
        accessToken,
        target,
        localHeadSha,
        resolution,
      );
    }

    if (!resolution.remoteBranchExists) {
      throw new Error(
        `Branch ${target.headBranch} is not on GitHub yet. Run gx pr --github first.`,
      );
    }

    const pull = await createDraftPullRequest(
      accessToken,
      target.repoFullName,
      target.headBranch,
      target.baseBranch,
      target.headBranch,
    );

    const nextResolution = await resolvePullForPush(
      accessToken,
      target.repoFullName,
      pull.number,
      target.headBranch,
      target.baseBranch,
    );

    return buildPullStatusResponse(
      accessToken,
      target,
      localHeadSha,
      nextResolution,
    );
  },
});

export const reconcilePullRequestAction = action({
  args: {
    pushId: v.optional(v.id("gxPrPushes")),
    bookmarkId: v.optional(v.string()),
  },
  handler: async (ctx, { pushId, bookmarkId }) => {
    const { payload, accessToken, target, resolution } =
      await loadAuthorizedMergeContext(ctx, {
        pushId,
        bookmarkId,
      });
    const localHeadSha = headCommitIdFromPayload(payload);
    const pull = activePullFromResolution(resolution);
    await reconcilePullRequest(
      accessToken,
      resolution.repoFullName,
      pull,
    );

    const refreshedResolution = await resolvePullForPush(
      accessToken,
      target.repoFullName,
      pull.number,
      target.headBranch,
      target.baseBranch,
    );
    return buildPullStatusResponse(
      accessToken,
      target,
      localHeadSha,
      refreshedResolution,
    );
  },
});

export const mergePullRequest = action({
  args: {
    pushId: v.optional(v.id("gxPrPushes")),
    bookmarkId: v.optional(v.string()),
  },
  handler: async (ctx, { pushId, bookmarkId }) => {
    const { userId, accessToken, target, resolution } =
      await loadAuthorizedMergeContext(ctx, {
        pushId,
        bookmarkId,
      });
    const pull = activePullFromResolution(resolution);

    const result = await mergePullRequestOnGithub(
      accessToken,
      resolution.repoFullName,
      pull,
    );
    await maybeMarkBookmarkMerged(
      ctx,
      userId,
      target.repoFullName,
      target.headBranch,
      result.pull.head.sha,
    );

    return {
      merged: true,
      markedReady: result.markedReady,
      resolution: resolution.kind,
      sourceHeadBranch: resolution.sourceHeadBranch,
      pullRequestNumber: result.pull.number,
      pullRequestUrl: result.pull.html_url,
      baseBranch: result.pull.base.ref,
      headBranch: result.pull.head.ref,
      repoFullName: resolution.repoFullName,
      sha: result.sha,
    };
  },
});

const branchPublishStatusValidator = v.object({
  repoFullName: v.string(),
  headBranch: v.string(),
  baseBranch: v.string(),
  remoteBranchExists: v.boolean(),
  localHeadSha: v.union(v.null(), v.string()),
  remoteHeadSha: v.union(v.null(), v.string()),
  driftStatus: v.union(
    v.literal("in_sync"),
    v.literal("github_ahead"),
    v.literal("gx_ahead"),
    v.literal("unknown"),
  ),
  checkStatus: v.union(
    v.literal("pending"),
    v.literal("success"),
    v.literal("failure"),
    v.literal("none"),
  ),
  integratedOnBase: v.boolean(),
  message: v.union(v.null(), v.string()),
  canLand: v.boolean(),
  landBlockedReason: v.union(v.null(), v.string()),
  branchUrl: v.string(),
  actionsUrl: v.string(),
});

async function loadAuthorizedPublishContext(
  ctx: ActionCtx,
  bookmarkId: string,
): Promise<{
  userId: string;
  accessToken: string;
  target: NonNullable<ReturnType<typeof mergeTargetFromPayload>>;
  localHeadSha: string | null;
  payload: unknown;
}> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Sign in with GitHub to publish and land GX bodies.");
  }

  const fromConvex = await ctx.runQuery(internal.gxPr.getBookmarkWithPayload, {
    userId: user._id,
    postgresBookmarkId: bookmarkId,
  });

  if (!fromConvex) {
    throw new Error("Bookmark not found. Run gx pr to sync this body.");
  }

  let payload: unknown = fromConvex.payload ?? null;
  if (!payload) {
    payload = await ctx.runAction(
      internal.gxBookmarkActions.loadBookmarkPayloadInternal,
      {
        userId: user._id,
        bookmarkId,
      },
    );
  }

  if (!payload) {
    throw new Error("Bookmark payload not found. Run gx pr to sync this body.");
  }

  const target = mergeTargetFromPayload(payload, fromConvex.repoFullName);
  if (!target) {
    throw new Error(
      "This bookmark is missing repo or branch metadata required for GitHub.",
    );
  }

  const accessToken = await getGithubAccessToken(ctx, user._id);
  const access = await verifyGithubRepoAccessWithToken(
    accessToken,
    target.repoFullName,
  );
  if (!access.ok) {
    throw new Error(access.message);
  }

  return {
    userId: user._id,
    accessToken,
    target,
    localHeadSha: headCommitIdFromPayload(payload),
    payload,
  };
}

/** Branch + GitHub Actions status for GX-first publish (no GitHub PR required). */
export const getPublishStatus = action({
  args: {
    bookmarkId: v.string(),
  },
  returns: branchPublishStatusValidator,
  handler: async (ctx, { bookmarkId }) => {
    const { userId, accessToken, target, localHeadSha, payload } =
      await loadAuthorizedPublishContext(ctx, bookmarkId);
    const status = await githubAdapter.fetchStatus({
      accessToken,
      repoFullName: target.repoFullName,
      headBranch: target.headBranch,
      baseBranch: target.baseBranch,
      localHeadSha,
    });
    const approvalBlockedReason = await ctx.runAction(
      internal.gxChangeReviewActions.loadStackApprovalBlockReason,
      {
        userId,
        bookmarkId,
        payload,
      },
    );
    if (approvalBlockedReason) {
      status.canLand = false;
      status.landBlockedReason = approvalBlockedReason;
      status.message = approvalBlockedReason;
    }
    if (status.integratedOnBase) {
      await maybeMarkBookmarkMerged(
        ctx,
        userId,
        target.repoFullName,
        target.headBranch,
        status.remoteHeadSha ?? undefined,
      );
    }
    return status;
  },
});

/** Land reviewed work by force-updating the base branch ref on GitHub. */
export const landBookmark = action({
  args: {
    bookmarkId: v.string(),
  },
  returns: v.object({
    landed: v.boolean(),
    sha: v.string(),
    baseBranch: v.string(),
    headBranch: v.string(),
    repoFullName: v.string(),
  }),
  handler: async (ctx, { bookmarkId }) => {
    const { userId, accessToken, target, localHeadSha, payload } =
      await loadAuthorizedPublishContext(ctx, bookmarkId);
    const approvalBlockedReason = await ctx.runAction(
      internal.gxChangeReviewActions.loadStackApprovalBlockReason,
      {
        userId,
        bookmarkId,
        payload,
      },
    );
    if (approvalBlockedReason) {
      throw new Error(approvalBlockedReason);
    }

    const status = await githubAdapter.fetchStatus({
      accessToken,
      repoFullName: target.repoFullName,
      headBranch: target.headBranch,
      baseBranch: target.baseBranch,
      localHeadSha,
    });
    if (status.integratedOnBase) {
      if (!status.remoteHeadSha) {
        throw new Error("Branch is integrated on base but remote SHA is unknown.");
      }
      await maybeMarkBookmarkMerged(
        ctx,
        userId,
        target.repoFullName,
        target.headBranch,
        status.remoteHeadSha,
      );
      return {
        landed: true,
        sha: status.remoteHeadSha,
        baseBranch: target.baseBranch,
        headBranch: target.headBranch,
        repoFullName: target.repoFullName,
      };
    }
    if (!status.canLand) {
      throw new Error(status.landBlockedReason ?? "Cannot land this bookmark yet.");
    }

    const result = await githubAdapter.integrateMerge({
      accessToken,
      repoFullName: target.repoFullName,
      headBranch: target.headBranch,
      baseBranch: target.baseBranch,
    });
    await maybeMarkBookmarkMerged(
      ctx,
      userId,
      target.repoFullName,
      target.headBranch,
      result.sha,
    );

    return {
      landed: true,
      sha: result.sha,
      baseBranch: result.baseBranch,
      headBranch: result.headBranch,
      repoFullName: target.repoFullName,
    };
  },
});
