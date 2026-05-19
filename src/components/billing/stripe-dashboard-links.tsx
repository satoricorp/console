type StripeDashboardLinksProps = {
  stripeCustomerId?: string | null;
  stripeCustomerUrl?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionUrl?: string | null;
};

export function StripeDashboardLinks({
  stripeCustomerId,
  stripeCustomerUrl,
  stripeSubscriptionId,
  stripeSubscriptionUrl,
}: StripeDashboardLinksProps) {
  if (!stripeCustomerUrl && !stripeSubscriptionUrl) return null;

  return (
    <div className="rounded-xl border border-dashed border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Stripe dashboard
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Open this user in Stripe (requires your Stripe account login).
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {stripeCustomerUrl && stripeCustomerId ? (
          <li>
            <a
              href={stripeCustomerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              Customer
            </a>
            <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {stripeCustomerId}
            </span>
          </li>
        ) : null}
        {stripeSubscriptionUrl && stripeSubscriptionId ? (
          <li>
            <a
              href={stripeSubscriptionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              Subscription
            </a>
            <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {stripeSubscriptionId}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

