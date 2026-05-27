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
  getBranchDriftStatus,
  getCheckStatusForRef,
  getPullRequest,
  createDraftPullRequest,
  getPullStatusForPush,
  getRemoteBranchSha,
  mergePullRequestOnGithub,
  type PullStatusResponse,
  type PullStatusSnapshot,
  reconcilePullRequest,
  resolvePullForPush,
} from "./lib/gxPrGithub";
import { GitHubAdapter } from "./lib/codeStorageAdapter";
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

const githubAdapter = new GitHubAdapter();

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

async function withDriftStatus(
  accessToken: string,
  repoFullName: string,
  headBranch: string,
  localHeadSha: string | null,
  statusResponse: PullStatusResponse,
) {
  const remoteHeadSha = await getRemoteBranchSha(
    accessToken,
    repoFullName,
    headBranch,
  );
  const driftStatus = await getBranchDriftStatus(
    accessToken,
    repoFullName,
    localHeadSha,
    remoteHeadSha,
  );
  const nextStatus = statusResponse.status
    ? {
        ...statusResponse.status,
        localHeadSha,
        remoteHeadSha,
        driftStatus,
      }
    : null;
  return {
    ...statusResponse,
    status: nextStatus,
  };
}

async function buildPullStatusResponse(
  accessToken: string,
  target: { repoFullName: string; headBranch: string },
  localHeadSha: string | null,
  resolution: Awaited<ReturnType<typeof resolvePullForPush>>,
) {
  const statusResponse = await getPullStatusForPush(accessToken, resolution);
  const adapterStatus = await githubAdapter.fetchStatus({
    accessToken,
    resolution,
  });
  const withDrift = await withDriftStatus(
    accessToken,
    target.repoFullName,
    target.headBranch,
    localHeadSha,
    statusResponse,
  );

  if (!withDrift.status) {
    return withDrift;
  }

  return {
    ...withDrift,
    status: {
      ...withDrift.status,
      checkStatus: adapterStatus.checks,
      mergeable:
        withDrift.status.mergeable ?? adapterStatus.mergeable ?? withDrift.status.mergeable,
      remoteHeadSha:
        (withDrift.status as PullStatusSnapshot & { remoteHeadSha?: string | null })
          .remoteHeadSha ?? adapterStatus.remoteSha,
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
