"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(secretKey);
}

export const processWebhook = internalAction({
  args: {
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { payload, signature }) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    }

    const stripe = getStripe();
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") return;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subscriptionId) return;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscriptionRecord(
          ctx,
          subscription,
          session.metadata?.userId,
        );
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertSubscriptionRecord(ctx, subscription);
        await syncPaymentMethodToConvex(ctx, stripe, subscription.customer);
        return;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await ctx.runMutation(internal.billing.deleteSubscription, {
          stripeSubscriptionId: subscription.id,
        });
        return;
      }
      case "setup_intent.succeeded": {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        const paymentMethodId =
          typeof setupIntent.payment_method === "string"
            ? setupIntent.payment_method
            : setupIntent.payment_method?.id;
        const customerId =
          typeof setupIntent.customer === "string"
            ? setupIntent.customer
            : setupIntent.customer?.id;

        if (paymentMethodId && customerId) {
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
          await syncPaymentMethodToConvex(ctx, stripe, customerId);
        }
        return;
      }
      case "customer.updated": {
        const customer = event.data.object as Stripe.Customer;
        if (!customer.deleted) {
          await syncPaymentMethodToConvex(ctx, stripe, customer.id);
        }
        return;
      }
      default:
        return;
    }
  },
});

async function upsertSubscriptionRecord(
  ctx: ActionCtx,
  subscription: Stripe.Subscription,
  userIdFromMetadata?: string | null,
) {
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  let userId: string | null =
    userIdFromMetadata ?? subscription.metadata.userId ?? null;

  if (!userId) {
    const customer = await ctx.runQuery(internal.billing.getCustomerByStripeId, {
      stripeCustomerId,
    });
    userId = customer?.userId ?? null;
  }

  if (!userId) {
    console.error(
      "Stripe subscription webhook missing user mapping",
      subscription.id,
    );
    return;
  }

  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price.id;

  await ctx.runMutation(internal.billing.upsertSubscription, {
    userId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    priceId,
    currentPeriodEnd: firstItem
      ? firstItem.current_period_end * 1000
      : undefined,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}

async function syncPaymentMethodToConvex(
  ctx: ActionCtx,
  stripe: Stripe,
  customerRef: string | Stripe.Customer | Stripe.DeletedCustomer,
) {
  const stripeCustomerId =
    typeof customerRef === "string" ? customerRef : customerRef.id;

  const customer = await stripe.customers.retrieve(stripeCustomerId, {
    expand: ["invoice_settings.default_payment_method"],
  });

  if (customer.deleted) return;

  const defaultPm = customer.invoice_settings?.default_payment_method;
  const pm = defaultPm && typeof defaultPm !== "string" ? defaultPm : null;

  await ctx.runMutation(internal.billing.updateCustomerPaymentMethod, {
    stripeCustomerId,
    paymentMethodBrand: pm?.card?.brand,
    paymentMethodLast4: pm?.card?.last4,
    paymentMethodExpMonth: pm?.card?.exp_month,
    paymentMethodExpYear: pm?.card?.exp_year,
  });
}
