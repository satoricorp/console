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
    .index("by_userId_fullName", ["userId", "fullName"]),

  gxCliSessions: defineTable({
    userId: v.string(),
    tokenHash: v.string(),
    githubUserId: v.number(),
    githubLogin: v.string(),
    machineId: v.string(),
    machineName: v.string(),
    gxVersion: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"])
    .index("by_userId_machineId", ["userId", "machineId"]),

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
});
