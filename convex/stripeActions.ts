"use node";

import Stripe from "stripe";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set in the Convex deployment");
  }
  return new Stripe(secretKey);
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the Convex deployment`);
  }
  return value;
}

async function getOrCreateStripeCustomer(
  ctx: ActionCtx,
  stripe: Stripe,
  user: { _id: string; email: string; name?: string | null },
) {
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

function getInvoiceClientSecret(
  invoice: Stripe.Invoice | string | null | undefined,
): string | null {
  if (!invoice || typeof invoice === "string") return null;
  return invoice.confirmation_secret?.client_secret ?? null;
}

function getSubscriptionClientSecret(subscription: Stripe.Subscription) {
  return getInvoiceClientSecret(subscription.latest_invoice);
}

async function getPlanSummary(stripe: Stripe, priceId: string) {
  const price = await stripe.prices.retrieve(priceId, {
    expand: ["product"],
  });

  const product =
    typeof price.product === "string"
      ? null
      : (price.product as Stripe.Product | null);

  const amount =
    price.unit_amount != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: price.currency,
        }).format(price.unit_amount / 100)
      : null;

  return {
    name: product?.name ?? "Console",
    description: product?.description ?? null,
    amount,
    interval: price.recurring?.interval ?? null,
    currency: price.currency,
  };
}

export const getBillingDetails = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to view billing");
    }

    const stripe = getStripe();
    const priceId = requireEnv("STRIPE_PRICE_ID");
    const plan = await getPlanSummary(stripe, priceId);

    const customer = await ctx.runQuery(internal.billing.getCustomerByUserId, {
      userId: user._id,
    });

    let paymentMethod: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    } | null = null;

    if (customer) {
      const stripeCustomer = await stripe.customers.retrieve(
        customer.stripeCustomerId,
        { expand: ["invoice_settings.default_payment_method"] },
      );

      if (!stripeCustomer.deleted) {
        const defaultPm =
          stripeCustomer.invoice_settings?.default_payment_method;
        const pm =
          defaultPm && typeof defaultPm !== "string"
            ? defaultPm
            : null;

        if (pm?.card) {
          paymentMethod = {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          };
          await ctx.runMutation(internal.billing.updateCustomerPaymentMethod, {
            stripeCustomerId: customer.stripeCustomerId,
            paymentMethodBrand: pm.card.brand,
            paymentMethodLast4: pm.card.last4,
            paymentMethodExpMonth: pm.card.exp_month,
            paymentMethodExpYear: pm.card.exp_year,
          });
        }
      }
    }

    return { plan, paymentMethod };
  },
});

export const createSubscriptionPayment = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to subscribe");
    }

    const stripe = getStripe();
    const priceId = requireEnv("STRIPE_PRICE_ID");
    const customerId = await getOrCreateStripeCustomer(ctx, stripe, {
      _id: user._id,
      email: user.email,
      name: user.name,
    });

    const existing = await ctx.runQuery(internal.billing.getSubscriptionByUserId, {
      userId: user._id,
    });

    if (existing && ["active", "trialing"].includes(existing.status)) {
      throw new Error("You already have an active subscription");
    }

    if (existing?.status === "incomplete") {
      const subscription = await stripe.subscriptions.retrieve(
        existing.stripeSubscriptionId,
        { expand: ["latest_invoice.confirmation_secret"] },
      );
      const clientSecret = getSubscriptionClientSecret(subscription);
      if (clientSecret) {
        return { clientSecret };
      }
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.confirmation_secret"],
      metadata: { userId: user._id },
    });

    const clientSecret = getSubscriptionClientSecret(subscription);
    if (!clientSecret) {
      throw new Error("Could not initialize payment");
    }

    const firstItem = subscription.items.data[0];
    await ctx.runMutation(internal.billing.upsertSubscription, {
      userId: user._id,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      priceId: firstItem?.price.id,
      currentPeriodEnd: firstItem
        ? firstItem.current_period_end * 1000
        : undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });

    return { clientSecret };
  },
});

export const createSetupIntent = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to update your payment method");
    }

    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(ctx, stripe, {
      _id: user._id,
      email: user.email,
      name: user.name,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    });

    if (!setupIntent.client_secret) {
      throw new Error("Could not initialize card update");
    }

    return { clientSecret: setupIntent.client_secret };
  },
});

export const cancelSubscription = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to manage billing");
    }

    const subscription = await ctx.runQuery(
      internal.billing.getSubscriptionByUserId,
      { userId: user._id },
    );

    if (!subscription) {
      throw new Error("No subscription found");
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    const firstItem = updated.items.data[0];
    await ctx.runMutation(internal.billing.upsertSubscription, {
      userId: user._id,
      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: updated.id,
      status: updated.status,
      priceId: firstItem?.price.id,
      currentPeriodEnd: firstItem
        ? firstItem.current_period_end * 1000
        : undefined,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
    });
  },
});

export const resumeSubscription = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to manage billing");
    }

    const subscription = await ctx.runQuery(
      internal.billing.getSubscriptionByUserId,
      { userId: user._id },
    );

    if (!subscription) {
      throw new Error("No subscription found");
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );

    const firstItem = updated.items.data[0];
    await ctx.runMutation(internal.billing.upsertSubscription, {
      userId: user._id,
      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: updated.id,
      status: updated.status,
      priceId: firstItem?.price.id,
      currentPeriodEnd: firstItem
        ? firstItem.current_period_end * 1000
        : undefined,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
    });
  },
});
