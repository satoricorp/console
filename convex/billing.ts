import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import {
  stripeCustomerDashboardUrl,
  stripeSubscriptionDashboardUrl,
} from "./stripeUrls";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export const getCustomerByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("billingCustomers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getCustomerByStripeId = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, { stripeCustomerId }) => {
    return await ctx.db
      .query("billingCustomers")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", stripeCustomerId),
      )
      .unique();
  },
});

export const saveCustomer = internalMutation({
  args: {
    userId: v.string(),
    stripeCustomerId: v.string(),
    email: v.string(),
    paymentMethodBrand: v.optional(v.string()),
    paymentMethodLast4: v.optional(v.string()),
    paymentMethodExpMonth: v.optional(v.number()),
    paymentMethodExpYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const patch = {
      stripeCustomerId: args.stripeCustomerId,
      email: args.email,
      updatedAt: now,
      ...(args.paymentMethodBrand !== undefined
        ? { paymentMethodBrand: args.paymentMethodBrand }
        : {}),
      ...(args.paymentMethodLast4 !== undefined
        ? { paymentMethodLast4: args.paymentMethodLast4 }
        : {}),
      ...(args.paymentMethodExpMonth !== undefined
        ? { paymentMethodExpMonth: args.paymentMethodExpMonth }
        : {}),
      ...(args.paymentMethodExpYear !== undefined
        ? { paymentMethodExpYear: args.paymentMethodExpYear }
        : {}),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("billingCustomers", {
      userId: args.userId,
      ...patch,
    });
  },
});

export const updateCustomerPaymentMethod = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    paymentMethodBrand: v.optional(v.string()),
    paymentMethodLast4: v.optional(v.string()),
    paymentMethodExpMonth: v.optional(v.number()),
    paymentMethodExpYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId),
      )
      .unique();

    if (!customer) return;

    await ctx.db.patch(customer._id, {
      paymentMethodBrand: args.paymentMethodBrand,
      paymentMethodLast4: args.paymentMethodLast4,
      paymentMethodExpMonth: args.paymentMethodExpMonth,
      paymentMethodExpYear: args.paymentMethodExpYear,
      updatedAt: Date.now(),
    });
  },
});

export const upsertSubscription = internalMutation({
  args: {
    userId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.string(),
    priceId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        priceId: args.priceId,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      });
      return existing._id;
    }

    return await ctx.db.insert("subscriptions", args);
  },
});

export const getSubscriptionByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});

export const deleteSubscription = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, { stripeSubscriptionId }) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", stripeSubscriptionId),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const getMyStripeBilling = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const customer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    const paymentMethod =
      customer?.paymentMethodBrand && customer.paymentMethodLast4
        ? {
            brand: customer.paymentMethodBrand,
            last4: customer.paymentMethodLast4,
            expMonth: customer.paymentMethodExpMonth,
            expYear: customer.paymentMethodExpYear,
          }
        : null;

    return {
      authUserId: user._id,
      customer: customer
        ? {
            stripeCustomerId: customer.stripeCustomerId,
            email: customer.email,
            paymentMethod,
            stripeDashboardUrl: stripeCustomerDashboardUrl(
              customer.stripeCustomerId,
            ),
            updatedAt: customer.updatedAt,
          }
        : null,
      subscription: subscription
        ? {
            stripeSubscriptionId: subscription.stripeSubscriptionId,
            stripeCustomerId: subscription.stripeCustomerId,
            status: subscription.status,
            isActive: ACTIVE_STATUSES.has(subscription.status),
            priceId: subscription.priceId,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
            stripeDashboardUrl: stripeSubscriptionDashboardUrl(
              subscription.stripeSubscriptionId,
            ),
          }
        : null,
    };
  },
});

/** @deprecated Use getMyStripeBilling */
export const getSubscriptionStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return { isActive: false, status: "none" as const, cancelAtPeriodEnd: false };
    }

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (!subscription) {
      return {
        isActive: false,
        status: "none" as const,
        cancelAtPeriodEnd: false,
      };
    }

    return {
      isActive: ACTIVE_STATUSES.has(subscription.status),
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    };
  },
});
