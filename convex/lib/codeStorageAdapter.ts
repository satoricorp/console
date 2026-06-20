/**
 * Narrow GitHub integration — temporary storage + CI, not review/merge UX.
 * GX Cloud owns review; this adapter pushes nothing (gx publishes branches),
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

export type FetchStatusOptions = {
  /** Skip GitHub Actions / commit status API calls (faster initial load). */
  includeCiChecks?: boolean;
};

export type LandPreflight = {
  remoteHeadSha: string | null;
  integratedOnBase: boolean;
  driftStatus: BranchDriftStatus;
  landBlockedReason: string | null;
};

export interface CodeStorageAdapter {
  /** Verify branch exists on remote after gx pr publish (does not push). */
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
    knownHeadSha?: string;
  }): Promise<{ sha: string; baseBranch: string; headBranch: string }>;

  /** Branch SHA, drift vs last gx publish, and optional GitHub Actions check status. */
  fetchStatus(
    input: {
      accessToken: string;
      repoFullName: string;
      headBranch: string;
      baseBranch: string;
      localHeadSha: string | null;
    },
    options?: FetchStatusOptions,
  ): Promise<PublishStatus>;

  /** Minimal GitHub checks before landing — no CI API calls. */
  preflightLand(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
    localHeadSha: string | null;
  }): Promise<LandPreflight>;
}

function githubBranchTreeUrl(repoFullName: string, branch: string): string {
  const encoded = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://github.com/${repoFullName}/tree/${encoded}`;
}

function landBlockersFromDrift(
  driftStatus: BranchDriftStatus,
): string | null {
  if (driftStatus === "gx_ahead") {
    return "GX is ahead of GitHub. Run gx pr to publish the latest revision.";
  }
  if (driftStatus === "github_ahead") {
    return "GitHub branch moved since the last gx pr. Republish from GX before landing.";
  }
  if (driftStatus !== "in_sync" && driftStatus !== "unknown") {
    return "Branch drift must be resolved before landing.";
  }
  return null;
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
        `Branch ${input.headBranch} does not exist on GitHub for ${input.repoFullName}. Run gx pr to publish it.`,
      );
    }
    return { remoteSha };
  }

  async integrateMerge(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
    knownHeadSha?: string;
  }): Promise<{ sha: string; baseBranch: string; headBranch: string }> {
    return landBranchToBase(
      input.accessToken,
      input.repoFullName,
      input.headBranch,
      input.baseBranch,
      input.knownHeadSha,
    );
  }

  async preflightLand(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
    baseBranch: string;
    localHeadSha: string | null;
  }): Promise<LandPreflight> {
    const remoteHeadSha = await getRemoteBranchSha(
      input.accessToken,
      input.repoFullName,
      input.headBranch,
    );
    if (!remoteHeadSha) {
      return {
        remoteHeadSha: null,
        integratedOnBase: false,
        driftStatus: "unknown",
        landBlockedReason:
          "Push this body with gx pr to publish the branch to GitHub.",
      };
    }

    const [driftStatus, integratedOnBase] = await Promise.all([
      getBranchDriftStatus(
        input.accessToken,
        input.repoFullName,
        input.localHeadSha,
        remoteHeadSha,
      ),
      isHeadIntegratedOnBase(
        input.accessToken,
        input.repoFullName,
        input.baseBranch,
        remoteHeadSha,
      ),
    ]);

    if (integratedOnBase) {
      return {
        remoteHeadSha,
        integratedOnBase: true,
        driftStatus,
        landBlockedReason: `Already integrated on ${input.baseBranch}.`,
      };
    }

    return {
      remoteHeadSha,
      integratedOnBase: false,
      driftStatus,
      landBlockedReason: landBlockersFromDrift(driftStatus),
    };
  }

  async fetchStatus(
    input: {
      accessToken: string;
      repoFullName: string;
      headBranch: string;
      baseBranch: string;
      localHeadSha: string | null;
    },
    options?: FetchStatusOptions,
  ): Promise<PublishStatus> {
    const includeCiChecks = options?.includeCiChecks ?? false;
    const remoteHeadSha = await getRemoteBranchSha(
      input.accessToken,
      input.repoFullName,
      input.headBranch,
    );
    const onRemote = remoteHeadSha != null;

    const [driftStatus, checkStatus, integratedOnBase] = await Promise.all([
      onRemote
        ? getBranchDriftStatus(
            input.accessToken,
            input.repoFullName,
            input.localHeadSha,
            remoteHeadSha,
          )
        : Promise.resolve("unknown" as BranchDriftStatus),
      includeCiChecks && remoteHeadSha
        ? getCheckStatusForRef(
            input.accessToken,
            input.repoFullName,
            remoteHeadSha,
          )
        : Promise.resolve("none" as CheckStatus),
      remoteHeadSha
        ? isHeadIntegratedOnBase(
            input.accessToken,
            input.repoFullName,
            input.baseBranch,
            remoteHeadSha,
          )
        : Promise.resolve(false),
    ]);

    let landBlockedReason: string | null = null;
    let message: string | null = null;

    if (integratedOnBase) {
      message = `Already integrated on ${input.baseBranch}.`;
      landBlockedReason = message;
    } else if (!onRemote) {
      landBlockedReason =
        "Push this body with gx pr to publish the branch to GitHub.";
      message = landBlockedReason;
    } else {
      landBlockedReason = landBlockersFromDrift(driftStatus);
      message = landBlockedReason;
      if (!landBlockedReason && includeCiChecks) {
        if (checkStatus === "pending") {
          message = "GitHub Actions are still running on the published branch.";
        } else if (checkStatus === "failure") {
          landBlockedReason =
            "GitHub Actions failed on the published branch.";
          message = landBlockedReason;
        }
      }
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
