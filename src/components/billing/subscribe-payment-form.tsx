"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent } from "@stripe/stripe-js";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/button";
import { confirmStripeSetupIntent } from "@/lib/confirm-stripe-setup";
import { getStripe } from "@/lib/stripe";
import { stripeExpressCheckoutOptions } from "@/lib/stripe-express-checkout-options";
import { stripePaymentElementOptions } from "@/lib/stripe-payment-element-options";
import { useStripeElementsAppearance } from "@/lib/use-stripe-elements-appearance";

function hasWalletButtons(
  event: StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent,
) {
  const methods = event.paymentMethods;
  if (!methods) return false;
  return Boolean(methods.applePay?.available || methods.googlePay?.available);
}

function TrialSubscribeForm({
  trialDays,
  onSuccess,
  fetchClientSecret,
}: {
  trialDays: number;
  onSuccess: () => void;
  fetchClientSecret: () => Promise<string>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const startTrial = useAction(api.stripeActions.startTrialSubscription);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [walletsAvailable, setWalletsAvailable] = useState(false);

  const returnUrl = `${window.location.origin}/billing?success=1`;

  const savePaymentMethodAndStartTrial = useCallback(async () => {
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const result = await confirmStripeSetupIntent(
      stripe,
      elements,
      returnUrl,
      fetchClientSecret,
    );
    if ("error" in result) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    try {
      await startTrial({ paymentMethodId: result.paymentMethodId });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start trial");
    } finally {
      setSubmitting(false);
    }
  }, [stripe, elements, returnUrl, fetchClientSecret, startTrial, onSuccess]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await savePaymentMethodAndStartTrial();
  }

  return (
    <div className="space-y-4">
      <ExpressCheckoutElement
        options={stripeExpressCheckoutOptions}
        onConfirm={() => void savePaymentMethodAndStartTrial()}
        onAvailablePaymentMethodsChange={(event) => {
          setWalletsAvailable(hasWalletButtons(event));
        }}
      />

      {walletsAvailable ? (
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              Or pay with card
            </span>
          </div>
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <PaymentElement options={stripePaymentElementOptions} />
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <Button
          type="submit"
          fullWidth
          disabled={!stripe || submitting}
          className="py-2.5 disabled:opacity-60"
        >
          {submitting ? "Starting trial…" : `Start ${trialDays}-day free trial`}
        </Button>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Your card is saved now. You will not be charged until your {trialDays}-day
          trial ends, then billing begins at the plan rate.
        </p>
      </form>
    </div>
  );
}

export function SubscribePaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const { appearance, themeKey } = useStripeElementsAppearance();
  const getElementsConfig = useAction(api.stripeActions.getStripeElementsConfig);
  const createSetupIntent = useAction(api.stripeActions.createTrialSetupIntent);
  const [currency, setCurrency] = useState("usd");
  const [trialDays, setTrialDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClientSecret = useCallback(async () => {
    const { clientSecret } = await createSetupIntent({});
    return clientSecret;
  }, [createSetupIntent]);

  useEffect(() => {
    let cancelled = false;

    getElementsConfig({})
      .then((config) => {
        if (!cancelled) {
          setCurrency(config.currency);
          setTrialDays(config.trialDays);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load payment form",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getElementsConfig]);

  if (loading) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <Elements
      key={themeKey}
      stripe={getStripe()}
      options={{
        mode: "setup",
        currency,
        appearance,
        paymentMethodTypes: ["card"],
      }}
    >
      <TrialSubscribeForm
        trialDays={trialDays}
        onSuccess={onSuccess}
        fetchClientSecret={fetchClientSecret}
      />
    </Elements>
  );
}
