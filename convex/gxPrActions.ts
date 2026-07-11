"use node";

import { v } from "convex/values";
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
  submitApprovingReview,
  type PullStatusResponse,
  type PullStatusSnapshot,
  reconcilePullRequest,
  resolvePullForPush,
} from "./lib/gxPrGithub";
import { githubAdapter } from "./lib/codeStorageAdapter";
import { headCommitIdFromPayload, mergeTargetFromPayload } from "./lib/gxPrPayload";
import {
  publishContextValidator,
  type PublishContext,
} from "./lib/bookmarkActionContext";
import type { Id } from "./_generated/dataModel";

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
  _ctx: ActionCtx,
  _bookmarkId: string,
): Promise<MergeContext> {
  throw new Error(
    "Bookmark merge context is loaded via server. Use pushId or call through the Next.js bookmark API with publishContext.",
  );
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
    const { payload, accessToken, target, resolution } =
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
        `Branch ${target.headBranch} is not on GitHub yet. Run gx pr first.`,
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
    const { accessToken, target, resolution } =
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
  publishContext: PublishContext,
): Promise<{
  accessToken: string;
  target: NonNullable<ReturnType<typeof mergeTargetFromPayload>>;
  localHeadSha: string | null;
}> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Sign in with GitHub to publish and land GX bodies.");
  }

  const target = {
    repoFullName: publishContext.repoFullName,
    headBranch: publishContext.headBranch,
    baseBranch: publishContext.baseBranch,
  };
  const localHeadSha = publishContext.localHeadSha;

  const accessToken = await getGithubAccessToken(ctx, user._id);
  const access = await verifyGithubRepoAccessWithToken(
    accessToken,
    target.repoFullName,
  );
  if (!access.ok) {
    throw new Error(access.message);
  }

  return {
    accessToken,
    target,
    localHeadSha,
  };
}

/** Approve the PR as the signed-in user, then merge. */
export const approveAndMergePullRequest = action({
  args: {
    bookmarkId: v.string(),
    publishContext: publishContextValidator,
    pullRequestNumber: v.optional(v.number()),
    approvalBody: v.optional(v.string()),
  },
  returns: v.object({
    approved: v.boolean(),
    merged: v.boolean(),
    selfApproval: v.boolean(),
    notice: v.union(v.string(), v.null()),
    pullRequestNumber: v.number(),
    pullRequestUrl: v.string(),
    sha: v.union(v.string(), v.null()),
    alreadyMerged: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { accessToken, target } = await loadAuthorizedPublishContext(
      ctx,
      args.publishContext,
    );

    const resolution = await resolvePullForPush(
      accessToken,
      target.repoFullName,
      args.pullRequestNumber,
      target.headBranch,
      target.baseBranch,
    );
    const pull = activePullFromResolution(resolution);

    if (pull.merged || pull.state === "closed") {
      // Re-fetch to confirm merged
      const current = await getPullRequest(
        accessToken,
        target.repoFullName,
        pull.number,
      );
      if (current.merged) {
        return {
          approved: false,
          merged: true,
          selfApproval: false,
          notice: "Pull request was already merged.",
          pullRequestNumber: current.number,
          pullRequestUrl: current.html_url,
          sha: current.head.sha,
          alreadyMerged: true,
        };
      }
    }

    const review = await submitApprovingReview(
      accessToken,
      target.repoFullName,
      pull.number,
      args.approvalBody,
    );

    const selfApproval = !review.approved && review.reason === "self_approval";
    if (!review.approved && !selfApproval) {
      throw new Error(
        typeof review.reason === "string"
          ? review.reason
          : "Could not approve pull request.",
      );
    }

    try {
      const result = await mergePullRequestOnGithub(
        accessToken,
        target.repoFullName,
        pull,
      );
      return {
        approved: review.approved,
        merged: true,
        selfApproval,
        notice: selfApproval
          ? "Could not approve your own pull request; merged without a new approval."
          : null,
        pullRequestNumber: result.pull.number,
        pullRequestUrl: result.pull.html_url,
        sha: result.sha ?? null,
        alreadyMerged: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Merge failed";
      // Surface branch-protection / merge errors verbatim; caller may record approve-only.
      throw new Error(
        review.approved || selfApproval
          ? `Approval recorded but merge failed: ${message}`
          : message,
      );
    }
  },
});

/** Branch + GitHub Actions status for GX-first publish (no GitHub PR required). */
export const getPublishStatus = action({
  args: {
    bookmarkId: v.string(),
    publishContext: publishContextValidator,
    includeCiChecks: v.optional(v.boolean()),
  },
  returns: branchPublishStatusValidator,
  handler: async (ctx, { publishContext, includeCiChecks }) => {
    const { accessToken, target, localHeadSha } =
      await loadAuthorizedPublishContext(ctx, publishContext);
    return githubAdapter.fetchStatus(
      {
        accessToken,
        repoFullName: target.repoFullName,
        headBranch: target.headBranch,
        baseBranch: target.baseBranch,
        localHeadSha,
      },
      { includeCiChecks: includeCiChecks ?? false },
    );
  },
});

/** Land reviewed work by force-updating the base branch ref on GitHub. */
export const landBookmark = action({
  args: {
    bookmarkId: v.string(),
    publishContext: publishContextValidator,
  },
  returns: v.object({
    landed: v.boolean(),
    sha: v.string(),
    baseBranch: v.string(),
    headBranch: v.string(),
    repoFullName: v.string(),
  }),
  handler: async (ctx, { publishContext }) => {
    const { accessToken, target, localHeadSha } =
      await loadAuthorizedPublishContext(ctx, publishContext);
    const preflight = await githubAdapter.preflightLand({
      accessToken,
      repoFullName: target.repoFullName,
      headBranch: target.headBranch,
      baseBranch: target.baseBranch,
      localHeadSha,
    });
    if (preflight.integratedOnBase) {
      if (!preflight.remoteHeadSha) {
        throw new Error("Branch is integrated on base but remote SHA is unknown.");
      }
      return {
        landed: true,
        sha: preflight.remoteHeadSha,
        baseBranch: target.baseBranch,
        headBranch: target.headBranch,
        repoFullName: target.repoFullName,
      };
    }
    if (preflight.landBlockedReason) {
      throw new Error(preflight.landBlockedReason);
    }
    if (!preflight.remoteHeadSha) {
      throw new Error("Branch is not on GitHub. Run gx pr to publish it first.");
    }

    const result = await githubAdapter.integrateMerge({
      accessToken,
      repoFullName: target.repoFullName,
      headBranch: target.headBranch,
      baseBranch: target.baseBranch,
      knownHeadSha: preflight.remoteHeadSha,
    });

    return {
      landed: true,
      sha: result.sha,
      baseBranch: result.baseBranch,
      headBranch: result.headBranch,
      repoFullName: target.repoFullName,
    };
  },
});
