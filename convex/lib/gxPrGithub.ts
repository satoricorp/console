export const githubHeaders = (accessToken: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${accessToken}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "console-app",
});

export type GithubPullDetails = {
  number: number;
  html_url: string;
  state: string;
  draft: boolean;
  merged?: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: { ref: string; sha: string };
  base: { ref: string };
};

export type PullMergeHealth =
  | "clean"
  | "dirty"
  | "behind"
  | "blocked"
  | "draft"
  | "merged"
  | "unknown"
  | "no_pr";

export type CheckStatus = "pending" | "success" | "failure" | "none";
export type BranchDriftStatus =
  | "in_sync"
  | "github_ahead"
  | "gx_ahead"
  | "unknown";

export type PullResolutionKind = "direct" | "canonical" | "missing";

export type PullStatusSnapshot = {
  pullRequestNumber: number;
  pullRequestUrl: string;
  health: PullMergeHealth;
  label: string;
  canReconcile: boolean;
  isDraft: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  mergeStateStatus: string | null;
  headSha: string;
  baseBranch: string;
  headBranch: string;
  checkStatus: CheckStatus;
};

export type PullStatusResponse = {
  resolution: PullResolutionKind;
  sourceHeadBranch: string;
  baseBranch: string;
  repoFullName: string;
  remoteBranchExists: boolean;
  canCreatePullRequest: boolean;
  message: string | null;
  status: PullStatusSnapshot | null;
  canonicalPull: {
    pullRequestNumber: number;
    pullRequestUrl: string;
    headBranch: string;
  } | null;
};

export type PullResolution = {
  kind: PullResolutionKind;
  sourceHeadBranch: string;
  baseBranch: string;
  repoFullName: string;
  pull: GithubPullDetails | null;
  remoteBranchExists: boolean;
  canonicalPull: GithubPullDetails | null;
  message: string | null;
};

type GithubMergeResult = {
  merged?: boolean;
  sha?: string;
  message?: string;
};

type GraphqlPullStatus = {
  number: number;
  url: string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus:
    | "BEHIND"
    | "BLOCKED"
    | "CLEAN"
    | "DIRTY"
    | "DRAFT"
    | "HAS_HOOKS"
    | "UNKNOWN"
    | "UNSTABLE";
  headRefOid: string;
  baseRefName: string;
  headRefName: string;
};

export function githubErrorMessage(
  status: number,
  body: string,
  action = "GitHub request",
): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) {
      return `${action} failed (${status}): ${parsed.message}`;
    }
  } catch {
    // Fall through to raw body.
  }
  return `${action} failed (${status}): ${body}`;
}

export function classifyPullStatus(
  pull: GithubPullDetails,
  mergeStateStatus: string | null,
): Pick<PullStatusSnapshot, "health" | "label" | "canReconcile"> {
  const isDirty =
    mergeStateStatus === "DIRTY" || pull.mergeable_state === "dirty";
  const isBehind = mergeStateStatus === "BEHIND";

  if (isDirty) {
    return {
      health: "dirty",
      label: pull.draft ? "Draft · Dirty" : "Dirty",
      canReconcile: true,
    };
  }
  if (isBehind) {
    return {
      health: "behind",
      label: pull.draft ? "Draft · Behind base" : "Behind base",
      canReconcile: true,
    };
  }
  if (pull.draft) {
    return { health: "draft", label: "Draft", canReconcile: false };
  }
  if (
    mergeStateStatus === "BLOCKED" ||
    pull.mergeable_state === "blocked"
  ) {
    return { health: "blocked", label: "Blocked", canReconcile: false };
  }
  if (pull.mergeable === true && pull.mergeable_state === "clean") {
    return { health: "clean", label: "Clean", canReconcile: false };
  }
  if (pull.mergeable == null) {
    return { health: "unknown", label: "Checking…", canReconcile: false };
  }
  return {
    health: "unknown",
    label: pull.mergeable_state ?? "Unknown",
    canReconcile: false,
  };
}

export function mergeBlockedReason(pull: GithubPullDetails): string | null {
  if (pull.state !== "open") {
    return `PR #${pull.number} is ${pull.state}.`;
  }
  if (pull.merged) {
    return `PR #${pull.number} is already merged.`;
  }
  if (pull.draft) {
    return `PR #${pull.number} is still a draft.`;
  }
  if (pull.mergeable === false) {
    if (pull.mergeable_state === "dirty") {
      return `PR #${pull.number} has merge conflicts with ${pull.base.ref}. Reconcile or resolve conflicts on GitHub, then try again.`;
    }
    if (pull.mergeable_state === "blocked") {
      return `PR #${pull.number} is blocked by branch protection or required checks.`;
    }
    return `PR #${pull.number} is not mergeable (${pull.mergeable_state ?? "unknown state"}).`;
  }
  if (pull.mergeable == null) {
    return `PR #${pull.number} merge status is still being computed by GitHub. Try again in a moment.`;
  }
  return null;
}

export async function findOpenPullRequest(
  accessToken: string,
  repoFullName: string,
  headBranch: string,
  baseBranch: string,
): Promise<GithubPullDetails | null> {
  const [owner] = repoFullName.split("/");
  const url = new URL(`https://api.github.com/repos/${repoFullName}/pulls`);
  url.searchParams.set("head", `${owner}:${headBranch}`);
  url.searchParams.set("base", baseBranch);
  url.searchParams.set("state", "open");

  const response = await fetch(url, { headers: githubHeaders(accessToken) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to find pull request (${response.status}): ${body}`);
  }

  const pulls = (await response.json()) as GithubPullDetails[];
  return pulls[0] ?? null;
}

async function listOpenPullRequests(
  accessToken: string,
  repoFullName: string,
  baseBranch: string,
): Promise<GithubPullDetails[]> {
  const url = new URL(`https://api.github.com/repos/${repoFullName}/pulls`);
  url.searchParams.set("state", "open");
  url.searchParams.set("base", baseBranch);
  url.searchParams.set("per_page", "100");

  const response = await fetch(url, { headers: githubHeaders(accessToken) });
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as GithubPullDetails[];
}

export async function remoteBranchExists(
  accessToken: string,
  repoFullName: string,
  branch: string,
): Promise<boolean> {
  const encodedRef = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/ref/heads/${encodedRef}`,
    { headers: githubHeaders(accessToken) },
  );
  return response.status === 200;
}

export async function getRemoteBranchSha(
  accessToken: string,
  repoFullName: string,
  branch: string,
): Promise<string | null> {
  const encodedRef = branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/ref/heads/${encodedRef}`,
    { headers: githubHeaders(accessToken) },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(githubErrorMessage(response.status, body, "Get branch ref"));
  }
  const payload = (await response.json()) as {
    object?: { sha?: string };
  };
  return payload.object?.sha ?? null;
}

export async function getBranchDriftStatus(
  accessToken: string,
  repoFullName: string,
  localSha: string | null,
  remoteSha: string | null,
): Promise<BranchDriftStatus> {
  if (!localSha || !remoteSha) {
    return "unknown";
  }
  if (localSha === remoteSha) {
    return "in_sync";
  }

  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/compare/${localSha}...${remoteSha}`,
    { headers: githubHeaders(accessToken) },
  );
  if (!response.ok) {
    return "unknown";
  }

  const payload = (await response.json()) as {
    status?: "identical" | "ahead" | "behind" | "diverged";
  };
  if (payload.status === "identical") {
    return "in_sync";
  }
  if (payload.status === "ahead") {
    return "github_ahead";
  }
  if (payload.status === "behind") {
    return "gx_ahead";
  }
  return "unknown";
}

/** True when base already points at head (GX land done or equivalent external update). */
export async function isHeadIntegratedOnBase(
  accessToken: string,
  repoFullName: string,
  baseBranch: string,
  headSha: string,
): Promise<boolean> {
  const baseSha = await getRemoteBranchSha(
    accessToken,
    repoFullName,
    baseBranch,
  );
  if (!baseSha) {
    return false;
  }
  if (baseSha === headSha) {
    return true;
  }
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/compare/${headSha}...${baseSha}`,
    { headers: githubHeaders(accessToken) },
  );
  if (!response.ok) {
    return false;
  }
  const payload = (await response.json()) as {
    status?: "identical" | "ahead" | "behind" | "diverged";
  };
  return payload.status === "behind" || payload.status === "identical";
}

export async function landBranchToBase(
  accessToken: string,
  repoFullName: string,
  headBranch: string,
  baseBranch: string,
  knownHeadSha?: string,
): Promise<{ sha: string; baseBranch: string; headBranch: string }> {
  const headSha =
    knownHeadSha ??
    (await getRemoteBranchSha(accessToken, repoFullName, headBranch));
  if (!headSha) {
    throw new Error(
      `Branch ${headBranch} is not on GitHub. Run gx pr to publish it first.`,
    );
  }

  const encodedBase = baseBranch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/git/refs/heads/${encodedBase}`,
    {
      method: "PATCH",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: headSha, force: true }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      githubErrorMessage(response.status, body, `Update ${baseBranch}`),
    );
  }

  const payload = (await response.json()) as { object?: { sha?: string } };
  return {
    sha: payload.object?.sha ?? headSha,
    baseBranch,
    headBranch,
  };
}

async function findCanonicalOpenPullRequest(
  accessToken: string,
  repoFullName: string,
  sourceHeadBranch: string,
  baseBranch: string,
): Promise<GithubPullDetails | null> {
  const pulls = await listOpenPullRequests(
    accessToken,
    repoFullName,
    baseBranch,
  );
  if (pulls.length === 0) {
    return null;
  }

  const sorted = [...pulls].sort((left, right) => right.number - left.number);
  return (
    sorted.find((pull) => pull.head.ref !== sourceHeadBranch) ?? null
  );
}

export async function createDraftPullRequest(
  accessToken: string,
  repoFullName: string,
  headBranch: string,
  baseBranch: string,
  title?: string,
): Promise<GithubPullDetails> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: title ?? headBranch,
        head: headBranch,
        base: baseBranch,
        draft: true,
        body: "Draft PR created from the GX console.",
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(githubErrorMessage(response.status, body, "Create PR"));
  }

  return (await response.json()) as GithubPullDetails;
}

export async function resolvePullForPush(
  accessToken: string,
  repoFullName: string,
  pullRequestNumber: number | undefined,
  headBranch: string,
  baseBranch: string,
): Promise<PullResolution> {
  const branchOnRemote = await remoteBranchExists(
    accessToken,
    repoFullName,
    headBranch,
  );

  if (pullRequestNumber != null) {
    try {
      const pull = await getPullRequest(
        accessToken,
        repoFullName,
        pullRequestNumber,
      );
      if (pull.state === "open") {
        return {
          kind: "direct",
          sourceHeadBranch: headBranch,
          baseBranch,
          repoFullName,
          pull,
          remoteBranchExists: branchOnRemote,
          canonicalPull: null,
          message: null,
        };
      }
    } catch {
      // Fall through to branch lookup.
    }
  }

  const direct = await findOpenPullRequest(
    accessToken,
    repoFullName,
    headBranch,
    baseBranch,
  );
  if (direct) {
    return {
      kind: "direct",
      sourceHeadBranch: headBranch,
      baseBranch,
      repoFullName,
      pull: direct,
      remoteBranchExists: branchOnRemote,
      canonicalPull: null,
      message: null,
    };
  }

  const canonical = await findCanonicalOpenPullRequest(
    accessToken,
    repoFullName,
    headBranch,
    baseBranch,
  );
  if (canonical) {
    return {
      kind: "canonical",
      sourceHeadBranch: headBranch,
      baseBranch,
      repoFullName,
      pull: null,
      remoteBranchExists: branchOnRemote,
      canonicalPull: canonical,
      message: `No open PR for ${headBranch}. Diff review is for this body; merge captured work via PR #${canonical.number} (${canonical.head.ref}).`,
    };
  }

  return {
    kind: "missing",
    sourceHeadBranch: headBranch,
    baseBranch,
    repoFullName,
    pull: null,
    remoteBranchExists: branchOnRemote,
    canonicalPull: null,
    message: branchOnRemote
      ? `No open PR for ${headBranch}, but the branch exists on GitHub. Create a PR or run gx pr from this body.`
      : `No open PR for ${headBranch}. Run gx pr to publish this body to GitHub.`,
  };
}

export function activePullFromResolution(
  resolution: PullResolution,
): GithubPullDetails {
  const pull = resolution.pull ?? resolution.canonicalPull;
  if (!pull) {
    throw new Error(
      resolution.message ??
        `No GitHub pull request is available for ${resolution.sourceHeadBranch}.`,
    );
  }
  return pull;
}

export async function getPullStatusForPush(
  accessToken: string,
  resolution: PullResolution,
): Promise<PullStatusResponse> {
  const activePull = resolution.pull ?? resolution.canonicalPull;
  if (!activePull) {
    return {
      resolution: "missing",
      sourceHeadBranch: resolution.sourceHeadBranch,
      baseBranch: resolution.baseBranch,
      repoFullName: resolution.repoFullName,
      remoteBranchExists: resolution.remoteBranchExists,
      canCreatePullRequest: resolution.remoteBranchExists,
      message: resolution.message,
      status: {
        pullRequestNumber: 0,
        pullRequestUrl: "",
        health: "no_pr",
        label: "No GitHub PR",
        canReconcile: false,
        isDraft: false,
        mergeable: null,
        mergeableState: null,
        mergeStateStatus: null,
        headSha: "",
        baseBranch: resolution.baseBranch,
        headBranch: resolution.sourceHeadBranch,
        checkStatus: "none",
      },
      canonicalPull: null,
    };
  }

  const status = await getPullStatusSnapshot(
    accessToken,
    resolution.repoFullName,
    activePull,
  );

  if (resolution.kind === "canonical") {
    return {
      resolution: "canonical",
      sourceHeadBranch: resolution.sourceHeadBranch,
      baseBranch: resolution.baseBranch,
      repoFullName: resolution.repoFullName,
      remoteBranchExists: resolution.remoteBranchExists,
      canCreatePullRequest: false,
      message: resolution.message,
      status: {
        ...status,
        label: `${status.label} · via PR #${activePull.number}`,
      },
      canonicalPull: {
        pullRequestNumber: activePull.number,
        pullRequestUrl: activePull.html_url,
        headBranch: activePull.head.ref,
      },
    };
  }

  return {
    resolution: "direct",
    sourceHeadBranch: resolution.sourceHeadBranch,
    baseBranch: resolution.baseBranch,
    repoFullName: resolution.repoFullName,
    remoteBranchExists: resolution.remoteBranchExists,
    canCreatePullRequest: false,
    message: null,
    status,
    canonicalPull: null,
  };
}

export async function getPullRequest(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<GithubPullDetails> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}`,
    { headers: githubHeaders(accessToken) },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to load pull request (${response.status}): ${body}`);
  }
  return (await response.json()) as GithubPullDetails;
}

async function getPullRequestGraphqlStatus(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<GraphqlPullStatus | null> {
  const [owner, name] = repoFullName.split("/");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query PullStatus($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            number
            url
            isDraft
            mergeable
            mergeStateStatus
            headRefOid
            baseRefName
            headRefName
          }
        }
      }`,
      variables: { owner, name, number: pullNumber },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    data?: { repository?: { pullRequest?: GraphqlPullStatus | null } | null };
  };
  return payload.data?.repository?.pullRequest ?? null;
}

function combinedStateToCheckStatus(state: string | undefined): CheckStatus {
  if (!state) return "none";
  if (state === "pending") return "pending";
  if (state === "success") return "success";
  if (state === "failure" || state === "error") return "failure";
  return "none";
}

function checkRunsToCheckStatus(
  runs: Array<{
    status?: string;
    conclusion?: string | null;
  }>,
): CheckStatus {
  if (runs.length === 0) return "none";

  let hasActive = false;
  let hasFailure = false;
  let hasSuccess = false;

  for (const run of runs) {
    if (run.status === "queued" || run.status === "in_progress") {
      hasActive = true;
      continue;
    }
    if (run.status !== "completed") {
      continue;
    }
    if (
      run.conclusion === "failure" ||
      run.conclusion === "timed_out" ||
      run.conclusion === "action_required" ||
      run.conclusion === "startup_failure"
    ) {
      hasFailure = true;
      continue;
    }
    if (
      run.conclusion === "success" ||
      run.conclusion === "neutral" ||
      run.conclusion === "skipped"
    ) {
      hasSuccess = true;
    }
  }

  if (hasFailure) return "failure";
  if (hasActive) return "pending";
  if (hasSuccess) return "success";
  return "none";
}

function mergeCheckStatuses(
  checkRunsStatus: CheckStatus,
  combinedStatus: CheckStatus,
): CheckStatus {
  if (checkRunsStatus === "failure" || combinedStatus === "failure") {
    return "failure";
  }
  if (checkRunsStatus === "pending" || combinedStatus === "pending") {
    return "pending";
  }
  if (checkRunsStatus === "success" || combinedStatus === "success") {
    return "success";
  }
  return "none";
}

export async function getCheckStatusForRef(
  accessToken: string,
  repoFullName: string,
  sha: string,
): Promise<CheckStatus> {
  const [checkRunsResponse, combinedStatusResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${repoFullName}/commits/${sha}/check-runs`, {
      headers: githubHeaders(accessToken),
    }),
    fetch(`https://api.github.com/repos/${repoFullName}/commits/${sha}/status`, {
      headers: githubHeaders(accessToken),
    }),
  ]);

  let checkRunsStatus: CheckStatus = "none";
  if (checkRunsResponse.ok) {
    const payload = (await checkRunsResponse.json()) as {
      check_runs?: Array<{ status?: string; conclusion?: string | null }>;
    };
    checkRunsStatus = checkRunsToCheckStatus(payload.check_runs ?? []);
  }

  let combinedStatus: CheckStatus = "none";
  if (combinedStatusResponse.ok) {
    const payload = (await combinedStatusResponse.json()) as {
      state?: string;
      statuses?: unknown[];
      total_count?: number;
    };
    const statusCount = payload.total_count ?? payload.statuses?.length ?? 0;
    // GitHub returns state=pending with zero contexts when no CI has reported yet.
    if (payload.state === "pending" && statusCount === 0) {
      combinedStatus = "none";
    } else {
      combinedStatus = combinedStateToCheckStatus(payload.state);
    }
  }

  return mergeCheckStatuses(checkRunsStatus, combinedStatus);
}

export async function resolvePullRequest(
  accessToken: string,
  repoFullName: string,
  pullRequestNumber: number | undefined,
  headBranch: string,
  baseBranch: string,
): Promise<GithubPullDetails> {
  const resolution = await resolvePullForPush(
    accessToken,
    repoFullName,
    pullRequestNumber,
    headBranch,
    baseBranch,
  );
  return activePullFromResolution(resolution);
}

export async function getPullStatusSnapshot(
  accessToken: string,
  repoFullName: string,
  pull: GithubPullDetails,
): Promise<PullStatusSnapshot> {
  const graphql = await getPullRequestGraphqlStatus(
    accessToken,
    repoFullName,
    pull.number,
  );
  const mergeStateStatus = graphql?.mergeStateStatus ?? null;
  const classified = classifyPullStatus(pull, mergeStateStatus);
  const checkStatus = await getCheckStatusForRef(
    accessToken,
    repoFullName,
    pull.head.sha,
  );

  return {
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.html_url,
    ...classified,
    isDraft: pull.draft,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state ?? null,
    mergeStateStatus,
    headSha: pull.head.sha,
    baseBranch: pull.base.ref,
    headBranch: pull.head.ref,
    checkStatus,
  };
}

export async function markPullRequestReady(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<GithubPullDetails> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}`,
    {
      method: "PATCH",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ draft: false }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    const graphqlReady = await markPullRequestReadyGraphql(
      accessToken,
      repoFullName,
      pullNumber,
    );
    if (graphqlReady) {
      return graphqlReady;
    }
    throw new Error(
      `Failed to mark PR #${pullNumber} ready for review (${response.status}): ${body}`,
    );
  }
  const updated = (await response.json()) as GithubPullDetails;
  if (updated.draft) {
    const graphqlReady = await markPullRequestReadyGraphql(
      accessToken,
      repoFullName,
      pullNumber,
    );
    if (graphqlReady) {
      return graphqlReady;
    }
  }
  return updated;
}

async function markPullRequestReadyGraphql(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
): Promise<GithubPullDetails | null> {
  const [owner, name] = repoFullName.split("/");
  const lookup = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query PullNode($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) { id isDraft }
        }
      }`,
      variables: { owner, name, number: pullNumber },
    }),
  });
  if (!lookup.ok) {
    return null;
  }
  const lookupPayload = (await lookup.json()) as {
    data?: {
      repository?: { pullRequest?: { id: string; isDraft: boolean } | null };
    };
    errors?: unknown;
  };
  const pullRequestId = lookupPayload.data?.repository?.pullRequest?.id;
  if (!pullRequestId) {
    return null;
  }

  const readyResponse = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation MarkReady($pullRequestId: ID!) {
        markPullRequestAsReady(input: { pullRequestId: $pullRequestId }) {
          pullRequest { id }
        }
      }`,
      variables: { pullRequestId },
    }),
  });
  if (!readyResponse.ok) {
    return null;
  }
  const readyPayload = (await readyResponse.json()) as {
    data?: { markPullRequestAsReady?: { pullRequest?: { id: string } | null } };
    errors?: unknown;
  };
  if (readyPayload.errors || !readyPayload.data?.markPullRequestAsReady?.pullRequest) {
    return null;
  }
  return getPullRequest(accessToken, repoFullName, pullNumber);
}

export async function waitUntilPullReadyForMerge(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
  attempts = 12,
): Promise<GithubPullDetails> {
  let pull = await getPullRequest(accessToken, repoFullName, pullNumber);
  for (let attempt = 0; attempt < attempts && pull.draft; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    pull = await getPullRequest(accessToken, repoFullName, pullNumber);
  }
  if (pull.draft) {
    throw new Error(
      `PR #${pullNumber} is still a draft. Open it on GitHub, click "Ready for review", then merge again.`,
    );
  }
  return pull;
}

export async function waitForMergeability(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
  attempts = 8,
): Promise<GithubPullDetails> {
  let pull = await getPullRequest(accessToken, repoFullName, pullNumber);
  for (let attempt = 0; attempt < attempts && pull.mergeable == null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    pull = await getPullRequest(accessToken, repoFullName, pullNumber);
  }
  return pull;
}

export async function updatePullRequestBranch(
  accessToken: string,
  repoFullName: string,
  pullNumber: number,
  headSha: string,
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${pullNumber}/update-branch`,
    {
      method: "PUT",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expected_head_sha: headSha }),
    },
  );

  if (response.status === 202 || response.status === 200) {
    return;
  }

  const body = await response.text();
  throw new Error(githubErrorMessage(response.status, body, "Reconcile"));
}

export async function reconcilePullRequest(
  accessToken: string,
  repoFullName: string,
  pull: GithubPullDetails,
): Promise<PullStatusSnapshot> {
  await updatePullRequestBranch(
    accessToken,
    repoFullName,
    pull.number,
    pull.head.sha,
  );

  const refreshed = await waitForMergeability(
    accessToken,
    repoFullName,
    pull.number,
  );
  const snapshot = await getPullStatusSnapshot(
    accessToken,
    repoFullName,
    refreshed,
  );

  if (snapshot.health === "dirty") {
    throw new Error(
      `PR #${pull.number} still has merge conflicts with ${pull.base.ref}. Resolve conflicts on GitHub, then reconcile again.`,
    );
  }

  return snapshot;
}

export async function mergePullRequestOnGithub(
  accessToken: string,
  repoFullName: string,
  pull: GithubPullDetails,
): Promise<GithubMergeResult & { pull: GithubPullDetails; markedReady: boolean }> {
  let markedReady = false;
  let current = await getPullRequest(accessToken, repoFullName, pull.number);

  if (current.draft) {
    current = await markPullRequestReady(
      accessToken,
      repoFullName,
      current.number,
    );
    markedReady = true;
    current = await waitUntilPullReadyForMerge(
      accessToken,
      repoFullName,
      current.number,
    );
    current = await waitForMergeability(
      accessToken,
      repoFullName,
      current.number,
    );
  }

  const blockedReason = mergeBlockedReason(current);
  if (blockedReason) {
    throw new Error(blockedReason);
  }

  const mergeResponse = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${current.number}/merge`,
    {
      method: "PUT",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ merge_method: "merge" }),
    },
  );

  if (!mergeResponse.ok) {
    const body = await mergeResponse.text();
    if (mergeResponse.status === 405 && body.includes("draft")) {
      current = await markPullRequestReady(
        accessToken,
        repoFullName,
        current.number,
      );
      markedReady = true;
      current = await waitUntilPullReadyForMerge(
        accessToken,
        repoFullName,
        current.number,
      );
      current = await waitForMergeability(
        accessToken,
        repoFullName,
        current.number,
      );
      const retryResponse = await fetch(
        `https://api.github.com/repos/${repoFullName}/pulls/${current.number}/merge`,
        {
          method: "PUT",
          headers: {
            ...githubHeaders(accessToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ merge_method: "merge" }),
        },
      );
      if (!retryResponse.ok) {
        const retryBody = await retryResponse.text();
        throw new Error(
          githubErrorMessage(retryResponse.status, retryBody, "Merge"),
        );
      }
      const result = (await retryResponse.json()) as GithubMergeResult;
      if (!result.merged) {
        throw new Error(
          result.message ?? "GitHub did not merge the pull request.",
        );
      }
      return { ...result, pull: current, markedReady };
    }
    throw new Error(githubErrorMessage(mergeResponse.status, body, "Merge"));
  }

  const result = (await mergeResponse.json()) as GithubMergeResult;
  if (!result.merged) {
    throw new Error(result.message ?? "GitHub did not merge the pull request.");
  }

  return { ...result, pull: current, markedReady };
}
