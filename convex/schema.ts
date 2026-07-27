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
  })
    .index("by_userId", ["userId"])
    .index("by_userId_fullName", ["userId", "fullName"])
    .index("by_fullName", ["fullName"]),

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

  // TEMP-FOR-PAYWALL-DEPLOY: these two tables are dead (no readers/writers; the
  // gxPr.ts / gxRevisions.ts modules are already deleted) and are removed from
  // the dev deployment. They are restored here ONLY so a prod deploy does not
  // attempt to drop them while prod rows still exist — Convex rejects that.
  // Remove these definitions again after purging both tables in the prod
  // dashboard. See the porcelain-pivot cleanup plan.
  gxPrPushes: defineTable({
    userId: v.string(),
    sessionId: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_sessionId", ["sessionId"]),

  gxRevisions: defineTable({
    userId: v.string(),
    pushId: v.id("gxPrPushes"),
    changeId: v.string(),
    commitId: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    message: v.string(),
    branchName: v.optional(v.string()),
    baseBranchName: v.optional(v.string()),
    pullRequestUrl: v.optional(v.string()),
    stackIndex: v.number(),
    createdAt: v.number(),
  })
    .index("by_changeId", ["changeId"])
    .index("by_repoFullName", ["repoFullName"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

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

  repoIndexJobs: defineTable({
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
    indexFiles: v.optional(
      v.array(v.object({ path: v.string(), sha: v.string() })),
    ),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_fullName", ["fullName"])
    .index("by_status", ["status"]),

  // OSS "watch" rail: operator-curated public repos that GX summarizes for free,
  // sessionless, posting as the GX bot user. Rows are written ONLY by the
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
