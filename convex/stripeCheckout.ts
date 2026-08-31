"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(secretKey);
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? "https://gx.run").replace(/\/+$/, "");
}

/**
 * Find the Stripe customer for a user, creating one the first time. The mapping
 * is kept in billingCustomers so the subscription webhooks (which only carry the
 * Stripe ids) can find their way back to the user.
 */
async function stripeCustomerIdFor(
  ctx: ActionCtx,
  stripe: Stripe,
  user: { _id: string; email: string; name?: string | null },
): Promise<string> {
  const existing = await ctx.runQuery(internal.billing.getCustomerByUserId, {
    userId: user._id,
  });
  if (existing) {
    return existing.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user._id },
  });

  await ctx.runMutation(internal.billing.saveCustomer, {
    userId: user._id,
    stripeCustomerId: customer.id,
    email: user.email,
  });

  return customer.id;
}

/**
 * Start a Stripe Checkout session for the gx Cloud subscription and return its
 * hosted URL. The page that calls this redirects the browser there; Stripe
 * sends the browser back to /checkout with a status, and the subscription
 * itself arrives through the webhook (stripeWebhookActions.ts).
 */
export const createCheckoutSession = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const user = await authComponent.getAuthUser(ctx);
    const priceId = process.env.STRIPE_PRICE_ID?.trim();
    if (!priceId) {
      throw new Error("STRIPE_PRICE_ID is not set");
    }

    const stripe = getStripe();
    const customer = await stripeCustomerIdFor(ctx, stripe, user);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl()}/checkout?status=success`,
      cancel_url: `${siteUrl()}/checkout?status=canceled`,
      // Both the session and the subscription carry the user id: the webhook
      // reads whichever event arrives first.
      metadata: { userId: user._id },
      subscription_data: { metadata: { userId: user._id } },
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }
    return { url: session.url };
  },
});

/** Stripe's hosted portal, where a subscriber updates their card or cancels. */
export const createBillingPortalSession = action({
  args: { returnPath: v.optional(v.string()) },
  handler: async (ctx, { returnPath }): Promise<{ url: string }> => {
    const user = await authComponent.getAuthUser(ctx);
    const existing = await ctx.runQuery(internal.billing.getCustomerByUserId, {
      userId: user._id,
    });
    if (!existing) {
      throw new Error("No billing account yet");
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: existing.stripeCustomerId,
      return_url: `${siteUrl()}${returnPath ?? "/checkout"}`,
    });
    return { url: session.url };
  },
});
