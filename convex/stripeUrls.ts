/** Stripe Dashboard deep links (for operators logged into stripe.com). */

function isTestMode() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_test_");
}

function dashboardBase() {
  return isTestMode()
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com";
}

export function stripeCustomerDashboardUrl(stripeCustomerId: string) {
  return `${dashboardBase()}/customers/${stripeCustomerId}`;
}

export function stripeSubscriptionDashboardUrl(stripeSubscriptionId: string) {
  return `${dashboardBase()}/subscriptions/${stripeSubscriptionId}`;
}
