import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  })
    .index("by_userId", ["userId"])
    .index("by_userId_fullName", ["userId", "fullName"]),
});
