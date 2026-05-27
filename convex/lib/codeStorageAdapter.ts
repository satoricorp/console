import {
  getPullStatusForPush,
  getRemoteBranchSha,
  mergePullRequestOnGithub,
  type CheckStatus,
  type GithubPullDetails,
  type PullResolution,
} from "./gxPrGithub";

export interface CodeStorageAdapter {
  publish(input: {
    accessToken: string;
    repoFullName: string;
    headBranch: string;
  }): Promise<{ remoteSha: string }>;
  integrateMerge(input: {
    accessToken: string;
    repoFullName: string;
    pull: GithubPullDetails;
  }): Promise<void>;
  fetchStatus(input: {
    accessToken: string;
    resolution: PullResolution;
  }): Promise<{ remoteSha: string | null; checks: CheckStatus; mergeable: boolean | null }>;
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
        `Branch ${input.headBranch} does not exist on GitHub for ${input.repoFullName}.`,
      );
    }
    return { remoteSha };
  }

  async integrateMerge(input: {
    accessToken: string;
    repoFullName: string;
    pull: GithubPullDetails;
  }): Promise<void> {
    await mergePullRequestOnGithub(input.accessToken, input.repoFullName, input.pull);
  }

  async fetchStatus(input: {
    accessToken: string;
    resolution: PullResolution;
  }): Promise<{ remoteSha: string | null; checks: CheckStatus; mergeable: boolean | null }> {
    const status = await getPullStatusForPush(input.accessToken, input.resolution);
    const remoteSha = await getRemoteBranchSha(
      input.accessToken,
      input.resolution.repoFullName,
      input.resolution.sourceHeadBranch,
    );
    return {
      remoteSha,
      checks: status.status?.checkStatus ?? "none",
      mergeable: status.status?.mergeable ?? null,
    };
  }
}
