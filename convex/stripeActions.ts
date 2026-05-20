"use node";

import Stripe from "stripe";
import { v } from "convex/values";
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

function getTrialDays() {
  const raw = process.env.STRIPE_TRIAL_DAYS;
  if (!raw) return 14;
  const days = Number.parseInt(raw, 10);
  if (!Number.isFinite(days) || days < 1 || days > 730) return 14;
  return days;
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  if (subscription.trial_end) {
    return subscription.trial_end * 1000;
  }
  const firstItem = subscription.items.data[0];
  return firstItem ? firstItem.current_period_end * 1000 : undefined;
}

async function persistSubscription(
  ctx: ActionCtx,
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription,
) {
  const firstItem = subscription.items.data[0];
  await ctx.runMutation(internal.billing.upsertSubscription, {
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    priceId: firstItem?.price.id,
    currentPeriodEnd: getSubscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
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

    return { plan, paymentMethod, trialDays: getTrialDays() };
  },
});

export const getStripeElementsConfig = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to manage billing");
    }

    const stripe = getStripe();
    const priceId = requireEnv("STRIPE_PRICE_ID");
    const price = await stripe.prices.retrieve(priceId);

    return {
      currency: price.currency,
      trialDays: getTrialDays(),
    };
  },
});

export const createTrialSetupIntent = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to start your trial");
    }

    const stripe = getStripe();
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

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: { userId: user._id, purpose: "trial" },
    });

    if (!setupIntent.client_secret) {
      throw new Error("Could not initialize payment setup");
    }

    return { clientSecret: setupIntent.client_secret };
  },
});

export const startTrialSubscription = action({
  args: {
    paymentMethodId: v.string(),
  },
  handler: async (ctx, { paymentMethodId }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in to start your trial");
    }

    const stripe = getStripe();
    const priceId = requireEnv("STRIPE_PRICE_ID");
    const trialDays = getTrialDays();
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
      await stripe.subscriptions.cancel(existing.stripeSubscriptionId);
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (
      paymentMethod.customer &&
      paymentMethod.customer !== customerId
    ) {
      throw new Error("Invalid payment method");
    }
    if (!paymentMethod.customer) {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    if (paymentMethod.card) {
      await ctx.runMutation(internal.billing.updateCustomerPaymentMethod, {
        stripeCustomerId: customerId,
        paymentMethodBrand: paymentMethod.card.brand,
        paymentMethodLast4: paymentMethod.card.last4,
        paymentMethodExpMonth: paymentMethod.card.exp_month,
        paymentMethodExpYear: paymentMethod.card.exp_year,
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      default_payment_method: paymentMethodId,
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: { userId: user._id },
    });

    await persistSubscription(ctx, user._id, customerId, subscription);

    return {
      status: subscription.status,
      trialEnd: subscription.trial_end
        ? subscription.trial_end * 1000
        : undefined,
      trialDays,
    };
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
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
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

    await persistSubscription(
      ctx,
      user._id,
      subscription.stripeCustomerId,
      updated,
    );
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

    await persistSubscription(
      ctx,
      user._id,
      subscription.stripeCustomerId,
      updated,
    );
  },
});
