import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const indexJobStatus = v.union(
  v.literal("pending"),
  v.literal("indexing"),
  v.literal("ready"),
  v.literal("failed"),
);

const indexTrigger = v.union(v.literal("connect"), v.literal("merge"));

export default defineSchema({
  billingCustomers: defineTable({
    userId: v.string(),
    stripeCustomerId: v.string(),
    email: v.string(),
    paymentMethodBrand: v.optional(v.string()),
    paymentMethodLast4: v.optional(v.string()),
    paymentMethodExpMonth: v.optional(v.number()),
    paymentMethodExpYear: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),

  subscriptions: defineTable({
    userId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.string(),
    priceId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  })
    .index("by_userId", ["userId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),

  userAppStates: defineTable({
    userId: v.string(),
    createdAt: v.number(),
    downloadScreenCompletedAt: v.optional(v.number()),
    communityScreenCompletedAt: v.optional(v.number()),
    githubAppInstallScreenCompletedAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    githubStarBonusClaimedAt: v.optional(v.number()),
    discordBonusClaimedAt: v.optional(v.number()),
    twitterBonusClaimedAt: v.optional(v.number()),
    windowsCliRequestedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  connectedRepos: defineTable({
    userId: v.string(),
    githubId: v.number(),
    owner: v.string(),
    name: v.string(),
    fullName: v.string(),
    private: v.boolean(),
    defaultBranch: v.optional(v.string()),
    connectedAt: v.number(),
    accessVerifiedAt: v.optional(v.number()),
    // Which installation this repository was connected through, so the connect
    // path can resolve an org the same way the webhook path does. Optional
    // because rows predating org identity have no way to know.
    installationId: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_fullName", ["userId", "fullName"])
    .index("by_fullName", ["fullName"]),

  // dead: no readers/writers as of 2026-07-28
  gxDesktopOAuthTickets: defineTable({
    ticketHash: v.string(),
    state: v.string(),
    githubAccessToken: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_ticketHash", ["ticketHash"]),

  gxCliSessions: defineTable({
    tokenHash: v.string(),
    userId: v.string(),
    githubUserId: v.number(),
    githubLogin: v.string(),
    machineId: v.string(),
    machineName: v.string(),
    gxVersion: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"]),

  // dead: no readers/writers as of 2026-07-28
  gxReviewArtifacts: defineTable({
    userId: v.string(),
    sessionId: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    artifact: v.any(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_sessionId", ["sessionId"])
    .index("by_repoFullName", ["repoFullName"]),

  // dead: no readers/writers as of 2026-07-28
  gxReviewComments: defineTable({
    userId: v.string(),
    reviewId: v.optional(v.string()),
    bookmarkId: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    scope: v.union(
      v.literal("pr"),
      v.literal("revision"),
      v.literal("file"),
      v.literal("line"),
    ),
    bodyMarkdown: v.string(),
    approvalPercent: v.optional(v.number()),
    authorLogin: v.string(),
    assigneeLogin: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_reviewId", ["reviewId"])
    .index("by_bookmarkId", ["bookmarkId"])
    .index("by_userId_bookmarkId", ["userId", "bookmarkId"])
    .index("by_repoFullName", ["repoFullName"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  // orgInstallations maps a GitHub App installation to the gx org that owns it.
  //
  // Postgres is the source of truth: the server resolves this from
  // github_app_installations when a delivery arrives and stamps it on the
  // forward. This table is the projection Convex needs, because the namespace
  // an index writes is gx-{orgId}-{repo} and Convex had no notion of an org at
  // all — every repository was indexed into one global namespace named only
  // after owner/repo, which two orgs with access to the same repository would
  // share and overwrite.
  //
  // It is also what lets the console answer "what has my org already indexed"
  // rather than only "what have I personally connected".
  orgInstallations: defineTable({
    installationId: v.number(),
    orgId: v.string(),
    accountLogin: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_installationId", ["installationId"])
    .index("by_orgId", ["orgId"]),

  repoIndexJobs: defineTable({
    // orgId is optional only so the existing rows validate; every write sets
    // it. Lookups go through by_org_fullName, because fullName stopped being
    // unique the moment two orgs could each index the same repository.
    orgId: v.optional(v.string()),
    fullName: v.string(),
    githubId: v.number(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.optional(v.string()),
    commitId: v.optional(v.string()),
    turbopufferNamespace: v.string(),
    status: indexJobStatus,
    trigger: v.optional(indexTrigger),
    filesTotal: v.optional(v.number()),
    filesIndexed: v.optional(v.number()),
    chunksIndexed: v.optional(v.number()),
    filesSkipped: v.optional(v.number()),
    treeTruncated: v.optional(v.boolean()),
    indexLog: v.optional(v.string()),
    // A merge that arrives while this job is already indexing. One field, not
    // a queue: indexing commit C supersedes A and B, so only the newest is
    // worth keeping. Drained when the running pass finalizes.
    queuedCommitId: v.optional(v.string()),
    queuedInstallationId: v.optional(v.number()),
    // When it was queued. Draining compares this against the run's startedAt,
    // because "different commit" is not the same question as "arrived while
    // this run was going" — and only the second one should start a new pass.
    queuedAt: v.optional(v.number()),
    indexFiles: v.optional(
      v.array(v.object({ path: v.string(), sha: v.string() })),
    ),
    // Whether the in-flight pass is indexing only the files that changed since
    // commitId. A resumed batch reads this back, because the stale sweep at the
    // end is only safe after a pass that rewrote everything.
    incremental: v.optional(v.boolean()),
    // The commit the namespace fully reflects, written only when a pass
    // finalizes. `commitId` cannot answer this: it is set when a pass *starts*,
    // so after a failure it names a commit the index only partly reached, and
    // diffing from it would treat the files that pass never got to as already
    // indexed and leave permanent holes. Absent until the first pass completes.
    lastIndexedCommitId: v.optional(v.string()),
    // Indexable files in the repository, as distinct from the count an
    // incremental pass touched. Carried on the plan so a resumed batch can still
    // report the index's real size when it finalizes.
    repoFileCount: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_fullName", ["fullName"])
    .index("by_org_fullName", ["orgId", "fullName"])
    .index("by_orgId", ["orgId"])
    .index("by_status", ["status"]),

  // OSS "watch" rail: operator-curated public repos that gx summarizes for free,
  // sessionless, posting as the gx bot user. Rows are written ONLY by the
  // internalMutations in watchlist.ts (Convex dashboard / CLI) — never from any
  // client-reachable path. Membership here is the sole gate for the free rail.
  watchedRepos: defineTable({
    // "owner/name" — the GitHub repo to watch. Must be public.
    fullName: v.string(),
    // Attribution tag baked into the tracked link (utm_campaign).
    campaign: v.optional(v.string()),
    // When false, the cron skips this repo without deleting its history.
    enabled: v.boolean(),
    // Free-text note for the operator (e.g. why it's on the list).
    note: v.optional(v.string()),
    addedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_fullName", ["fullName"])
    .index("by_enabled", ["enabled"]),
});
