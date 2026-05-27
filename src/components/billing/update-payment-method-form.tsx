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

function UpdateForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [walletsAvailable, setWalletsAvailable] = useState(false);

  const returnUrl = `${window.location.origin}/billing?updated=1`;

  const savePaymentMethod = useCallback(async () => {
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const result = await confirmStripeSetupIntent(stripe, elements, returnUrl);
    if ("error" in result) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    onSuccess();
    setSubmitting(false);
  }, [stripe, elements, returnUrl, onSuccess]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await savePaymentMethod();
  }

  return (
    <div className="space-y-4">
      <ExpressCheckoutElement
        options={stripeExpressCheckoutOptions}
        onConfirm={() => void savePaymentMethod()}
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
        <div className="flex gap-2">
          <Button type="submit" disabled={!stripe || submitting}>
            {submitting ? "Saving…" : "Save card"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export function UpdatePaymentMethodForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { appearance, themeKey } = useStripeElementsAppearance();
  const createSetupIntent = useAction(api.stripeActions.createSetupIntent);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    createSetupIntent({})
      .then((intent) => {
        if (!cancelled) setClientSecret(intent.clientSecret);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load card form",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [createSetupIntent]);

  if (loading) {
    return (
      <div className="h-32 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    );
  }

  if (error || !clientSecret) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        {error ?? "Could not load card form"}
      </p>
    );
  }

  return (
    <Elements
      key={themeKey}
      stripe={getStripe()}
      options={{
        clientSecret,
        appearance,
      }}
    >
      <UpdateForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}
