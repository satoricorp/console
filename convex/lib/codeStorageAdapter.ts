/**
 * Narrow GitHub integration — temporary storage + CI, not review/merge UX.
 * GX Cloud owns review; this adapter pushes nothing (use gx pr --github from CLI),
 * reads SHA/drift/checks, and propagates GX-initiated land to the default branch.
 *
 * Swap `GitHubAdapter` for another `CodeStorageAdapter` when storage_backend changes.
 */
import {
  getBranchDriftStatus,
  getCheckStatusForRef,
  getRemoteBranchSha,
  isHeadIntegratedOnBase,
  landBranchToBase,
  remoteBranchExists,
  type BranchDriftStatus,
  type CheckStatus,
} from "./gxPrGithub";

export type { BranchDriftStatus, CheckStatus };

export type PublishStatus = {
  repoFullName: string;
  headBranch: string;
  baseBranch: string;
  remoteBranchExists: boolean;
  localHeadSha: string | null;
  remoteHeadSha: string | null;
  driftStatus: BranchDriftStatus;
  checkStatus: CheckStatus;
  integratedOnBase: boolean;
  message: string | null;
  canLand: boolean;
  landBlockedReason: string | null;
  branchUrl: string;
  actionsUrl: string;
};

export interface CodeStorageAdapter {
  /** Verify branch exists on remote after gx pr --github (does not push). */
  publish(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
  }): Promise<{ remoteSha: string }>;

  /** Propagate GX land to storage: update default branch ref to published head. */
  integrateMerge(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<{ sha: string; baseBranch: string; headBranch: string }>;

  /** Branch SHA, drift vs last gx publish, and GitHub Actions check status. */
  fetchStatus(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
    localHeadSha: string | null;
  }): Promise<PublishStatus>;
}

function githubBranchTreeUrl(repoFullName: string, branch: string): string {
  const encoded = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://github.com/${repoFullName}/tree/${encoded}`;
}

export class GitHubAdapter implements CodeStorageAdapter {
  async publish(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
  }): Promise<{ remoteSha: string }> {
    const remoteSha = await getRemoteBranchSha(
      input.accessToken,
      input.repoFullName,
      input.headBranch,
    );
    if (!remoteSha) {
      throw new Error(
        `Branch ${input.headBranch} does not exist on GitHub for ${input.repoFullName}. Run gx pr --github to publish it.`,
      );
    }
    return { remoteSha };
  }

  async integrateMerge(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<{ sha: string; baseBranch: string; headBranch: string }> {
    return landBranchToBase(
      input.accessToken,
      input.repoFullName,
      input.headBranch,
      input.baseBranch,
    );
  }

  async fetchStatus(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
    localHeadSha: string | null;
  }): Promise<PublishStatus> {
    const onRemote = await remoteBranchExists(
      input.accessToken,
      input.repoFullName,
      input.headBranch,
    );
    const remoteHeadSha = onRemote
      ? await getRemoteBranchSha(
          input.accessToken,
          input.repoFullName,
          input.headBranch,
        )
      : null;
    const driftStatus = await getBranchDriftStatus(
      input.accessToken,
      input.repoFullName,
      input.localHeadSha,
      remoteHeadSha,
    );
    const checkStatus = remoteHeadSha
      ? await getCheckStatusForRef(
          input.accessToken,
          input.repoFullName,
          remoteHeadSha,
        )
      : "none";
    const integratedOnBase =
      remoteHeadSha != null
        ? await isHeadIntegratedOnBase(
            input.accessToken,
            input.repoFullName,
            input.baseBranch,
            remoteHeadSha,
          )
        : false;

    let landBlockedReason: string | null = null;
    let message: string | null = null;

    if (integratedOnBase) {
      message = `Already integrated on ${input.baseBranch}.`;
      landBlockedReason = message;
    } else if (!onRemote) {
      landBlockedReason =
        "Push this body with gx pr --github to publish the branch to GitHub.";
      message = landBlockedReason;
    } else if (driftStatus === "gx_ahead") {
      landBlockedReason =
        "GX is ahead of GitHub. Run gx pr --github to publish the latest revision.";
      message = landBlockedReason;
    } else if (driftStatus === "github_ahead") {
      landBlockedReason =
        "GitHub branch moved since the last gx pr --github. Republish from GX before landing.";
      message = landBlockedReason;
    } else if (checkStatus === "pending") {
      landBlockedReason =
        "GitHub Actions are still running on the published branch.";
      message = "Waiting for GitHub Actions…";
    } else if (checkStatus === "failure") {
      landBlockedReason = "GitHub Actions failed on the published branch.";
      message = landBlockedReason;
    } else if (driftStatus !== "in_sync" && driftStatus !== "unknown") {
      landBlockedReason = "Branch drift must be resolved before landing.";
      message = landBlockedReason;
    }

    const canLand =
      !integratedOnBase &&
      landBlockedReason === null &&
      remoteHeadSha != null;

    return {
      repoFullName: input.repoFullName,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      remoteBranchExists: onRemote,
      localHeadSha: input.localHeadSha,
      remoteHeadSha,
      driftStatus,
      checkStatus,
      integratedOnBase,
      message,
      canLand,
      landBlockedReason,
      branchUrl: githubBranchTreeUrl(input.repoFullName, input.headBranch),
      actionsUrl: `https://github.com/${input.repoFullName}/actions`,
    };
  }
}

/** v1 backend; select by bookmark.storage_backend when additional adapters ship. */
export function getCodeStorageAdapter(_storageBackend = "github"): CodeStorageAdapter {
  return new GitHubAdapter();
}

export const githubAdapter = getCodeStorageAdapter("github");
