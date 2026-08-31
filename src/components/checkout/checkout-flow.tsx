"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { SIGNED_IN_HOME_URL } from "@/lib/site-links";

const PRICE_LABEL = "$20/month";

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {title}
      </h1>
      <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-default disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {children}
      <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

export function CheckoutFlow() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const usage = useQuery(api.runs.getMyRunUsage);
  const createCheckoutSession = useAction(
    api.stripeCheckout.createCheckoutSession,
  );
  const createBillingPortalSession = useAction(
    api.stripeCheckout.createBillingPortalSession,
  );
  const [manualRedirecting, setManualRedirecting] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  function goToStripe() {
    setManualRedirecting(true);
    setError(null);
    createCheckoutSession({})
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((err: unknown) => {
        console.error("Checkout failed", err);
        setError(err instanceof Error ? err.message : "Checkout failed");
        setManualRedirecting(false);
      });
  }

  function goToPortal() {
    setManualRedirecting(true);
    setError(null);
    createBillingPortalSession({ returnPath: "/checkout" })
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((err: unknown) => {
        console.error("Billing portal failed", err);
        setError(err instanceof Error ? err.message : "Could not open billing");
        setManualRedirecting(false);
      });
  }

  // Coming here from the CLI's checkout URL means "take me to pay": go to
  // Stripe as soon as we know there is nothing to pay for already. Returning
  // from Stripe (status set) and existing subscribers stay on this page.
  const autoRedirect =
    status === null && usage !== undefined && usage !== null && !usage.subscribed;
  useEffect(() => {
    if (!autoRedirect || autoStarted.current) return;
    // Once only: the page re-renders while the session is being created, and a
    // second session would be a second Stripe tab.
    autoStarted.current = true;
    createCheckoutSession({})
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((err: unknown) => {
        console.error("Checkout failed", err);
        setError(err instanceof Error ? err.message : "Checkout failed");
        setAutoFailed(true);
      });
  }, [autoRedirect, createCheckoutSession]);

  const redirecting = (autoRedirect && !autoFailed) || manualRedirecting;

  if (usage === undefined) {
    return <Spinner />;
  }

  if (usage === null) {
    return (
      <Heading
        title="Sign in to subscribe"
        body="Sign in with GitHub, then come back to this page."
      />
    );
  }

  if (status === "success" || usage.subscribed) {
    return (
      <>
        <Heading
          title={status === "success" ? "You're subscribed" : "Subscription active"}
          body={
            status === "success" && !usage.subscribed
              ? "Thanks. Your subscription is being confirmed — gx Cloud AI unlocks within a minute."
              : `gx Cloud AI is unlocked: unlimited reviews and PR summaries at ${PRICE_LABEL}.`
          }
        />
        {error ? (
          <p className="text-[13px] leading-5 text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Link
            href={SIGNED_IN_HOME_URL}
            className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Back to gx
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          {usage.subscribed ? (
            <button
              type="button"
              onClick={goToPortal}
              disabled={redirecting}
              className="cursor-pointer text-[13px] text-zinc-600 underline decoration-zinc-400 underline-offset-2 transition-colors hover:text-zinc-950 disabled:cursor-default dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Manage billing
            </button>
          ) : null}
        </div>
      </>
    );
  }

  const usedAll = usage.remaining === 0;
  return (
    <>
      <Heading
        title={redirecting ? "Sending you to Stripe…" : "Subscribe to gx"}
        body={
          usedAll
            ? `You've used all ${usage.limit} free runs. gx Cloud AI is ${PRICE_LABEL} for unlimited reviews and PR summaries.`
            : `${usage.remaining} of ${usage.limit} free runs left. gx Cloud AI is ${PRICE_LABEL} for unlimited reviews and PR summaries.`
        }
      />
      {status === "canceled" ? (
        <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
          Checkout was canceled — nothing was charged.
        </p>
      ) : null}
      {error ? (
        <p className="text-[13px] leading-5 text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div>
        <PrimaryButton onClick={goToStripe} disabled={redirecting}>
          {redirecting ? "Opening Stripe" : `Subscribe · ${PRICE_LABEL}`}
        </PrimaryButton>
      </div>
    </>
  );
}
