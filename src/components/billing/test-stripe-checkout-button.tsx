"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function TestStripeCheckoutButton() {
  const createCheckout = useAction(api.stripeActions.createTestCheckoutSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openStripeCheckout() {
    setLoading(true);
    setError(null);
    try {
      const { url } = await createCheckout({});
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Stripe Checkout");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant="dashed"
        disabled={loading}
        onClick={() => void openStripeCheckout()}
      >
        {loading ? "Opening Stripe…" : "Test billing on Stripe Checkout"}
      </Button>
      <Link
        href="/billing"
        className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        Or test embedded billing on /billing
      </Link>
      {error ? (
        <p className="max-w-xs text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
