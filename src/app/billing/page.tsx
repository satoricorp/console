"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { SubscribePaymentForm } from "@/components/billing/subscribe-payment-form";
import { StripeDashboardLinks } from "@/components/billing/stripe-dashboard-links";
import { UpdatePaymentMethodForm } from "@/components/billing/update-payment-method-form";

type BillingDetails = {
  plan: {
    name: string;
    description: string | null;
    amount: string | null;
    interval: string | null;
    currency: string;
  };
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
};

function formatPlanPrice(plan: BillingDetails["plan"]) {
  if (!plan.amount) return null;
  if (plan.interval) {
    return `${plan.amount} / ${plan.interval}`;
  }
  return plan.amount;
}

function formatCard(brand: string, last4: string) {
  return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ···· ${last4}`;
}

function BillingContent() {
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const stripeBilling = useQuery(
    api.billing.getMyStripeBilling,
    session?.user ? {} : "skip",
  );
  const getBillingDetails = useAction(api.stripeActions.getBillingDetails);
  const cancelSubscription = useAction(api.stripeActions.cancelSubscription);
  const resumeSubscription = useAction(api.stripeActions.resumeSubscription);

  const [billingDetails, setBillingDetails] = useState<BillingDetails | null>(
    null,
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showUpdateCard, setShowUpdateCard] = useState(false);
  const [loading, setLoading] = useState<"cancel" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const paymentSuccess = searchParams.get("success") === "1";
  const cardUpdated = searchParams.get("updated") === "1";

  useEffect(() => {
    if (paymentSuccess || cardUpdated) {
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("updated");
      window.history.replaceState({}, "", url.pathname);
    }
  }, [paymentSuccess, cardUpdated]);

  useEffect(() => {
    if (!session?.user) {
      setBillingDetails(null);
      return;
    }

    let cancelled = false;
    setDetailsLoading(true);

    getBillingDetails({})
      .then((details) => {
        if (!cancelled) setBillingDetails(details);
      })
      .catch(() => {
        if (!cancelled) setBillingDetails(null);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user, getBillingDetails, refreshKey]);

  function refreshBilling() {
    setRefreshKey((key) => key + 1);
    setShowUpdateCard(false);
  }

  async function handleCancel() {
    setError(null);
    setLoading("cancel");
    try {
      await cancelSubscription({});
      refreshBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setLoading(null);
    }
  }

  async function handleResume() {
    setError(null);
    setLoading("resume");
    try {
      await resumeSubscription({});
      refreshBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume");
    } finally {
      setLoading(null);
    }
  }

  const planPrice = billingDetails ? formatPlanPrice(billingDetails.plan) : null;
  const subscription = stripeBilling?.subscription;
  const paymentMethod =
    stripeBilling?.customer?.paymentMethod ?? billingDetails?.paymentMethod ?? null;
  const isActive = subscription?.isActive ?? false;

  return (
    <>
      {paymentSuccess ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Payment received. Your subscription should activate shortly.
        </p>
      ) : null}

      {cardUpdated ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Payment method updated.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {sessionPending ? (
        <div className="h-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      ) : !session?.user ? (
        <div className="flex flex-col items-start gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sign in with GitHub before subscribing.
          </p>
          <AuthButton />
        </div>
      ) : stripeBilling === undefined || detailsLoading ? (
        <div className="h-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      ) : isActive ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {billingDetails?.plan.name ?? "Console"}
                </p>
                {planPrice ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {planPrice}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                  Active
                  {subscription?.cancelAtPeriodEnd
                    ? " — cancels at period end"
                    : ""}
                </p>
                {subscription?.currentPeriodEnd ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {subscription.cancelAtPeriodEnd ? "Access until" : "Renews"}{" "}
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-zinc-100 pt-4 dark:border-zinc-900">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Payment method
                </p>
                {paymentMethod ? (
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                    {formatCard(paymentMethod.brand, paymentMethod.last4)}
                    {paymentMethod.expMonth && paymentMethod.expYear ? (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {" "}
                        · {paymentMethod.expMonth}/{paymentMethod.expYear}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    No card on file
                  </p>
                )}
                {!showUpdateCard ? (
                  <button
                    type="button"
                    onClick={() => setShowUpdateCard(true)}
                    className="mt-3 text-sm font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                  >
                    Update card
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {showUpdateCard ? (
            <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
              <p className="mb-4 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Update payment method
              </p>
              <UpdatePaymentMethodForm
                onSuccess={refreshBilling}
                onCancel={() => setShowUpdateCard(false)}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {subscription?.cancelAtPeriodEnd ? (
              <button
                type="button"
                disabled={loading !== null}
                onClick={() => void handleResume()}
                className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {loading === "resume" ? "Resuming…" : "Resume subscription"}
              </button>
            ) : (
              <button
                type="button"
                disabled={loading !== null}
                onClick={() => void handleCancel()}
                className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {loading === "cancel" ? "Canceling…" : "Cancel subscription"}
              </button>
            )}
          </div>

          <StripeDashboardLinks
            stripeCustomerId={stripeBilling?.customer?.stripeCustomerId}
            stripeCustomerUrl={stripeBilling?.customer?.stripeDashboardUrl}
            stripeSubscriptionId={subscription?.stripeSubscriptionId}
            stripeSubscriptionUrl={subscription?.stripeDashboardUrl}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {billingDetails?.plan.name ?? "Console"}
            </p>
            {billingDetails?.plan.description ? (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {billingDetails.plan.description}
              </p>
            ) : null}
            {planPrice ? (
              <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {planPrice}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="mb-4 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Payment details
            </p>
            {!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to your environment.
              </p>
            ) : (
              <SubscribePaymentForm onSuccess={refreshBilling} />
            )}
          </div>

          {stripeBilling?.customer ? (
            <StripeDashboardLinks
              stripeCustomerId={stripeBilling.customer.stripeCustomerId}
              stripeCustomerUrl={stripeBilling.customer.stripeDashboardUrl}
              stripeSubscriptionId={subscription?.stripeSubscriptionId}
              stripeSubscriptionUrl={subscription?.stripeDashboardUrl ?? undefined}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

export default function BillingPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Billing
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Manage your subscription and payment method. Card details are processed
          securely by Stripe.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="h-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        }
      >
        <BillingContent />
      </Suspense>
    </main>
  );
}

