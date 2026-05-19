"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/button";
import { getStripe, stripeElementsAppearance } from "@/lib/stripe";

function TrialSubscribeForm({
  trialDays,
  onSuccess,
}: {
  trialDays: number;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const startTrial = useAction(api.stripeActions.startTrialSubscription);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/billing?success=1`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Could not save card");
      setSubmitting(false);
      return;
    }

    const paymentMethodId =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;

    if (!paymentMethodId) {
      setError("Could not verify payment method. Try again.");
      setSubmitting(false);
      return;
    }

    try {
      await startTrial({ paymentMethodId });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start trial");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <PaymentElement />
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
        Your card is saved now. You will not be charged until the trial ends.
      </p>
    </form>
  );
}

export function SubscribePaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const createTrialSetup = useAction(api.stripeActions.createTrialSetupIntent);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    createTrialSetup({})
      .then((result) => {
        if (!cancelled) {
          setClientSecret(result.clientSecret);
          setTrialDays(result.trialDays);
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
  }, [createTrialSetup]);

  if (loading) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!clientSecret) return null;

  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret,
        appearance: stripeElementsAppearance,
      }}
    >
      <TrialSubscribeForm trialDays={trialDays} onSuccess={onSuccess} />
    </Elements>
  );
}
