/** Stripe billing stub — checkout URL placeholder until WP-5f full integration. */

export function getUpgradeCheckoutUrl(orgId: string): string {
  const base =
    process.env.GX_UPGRADE_URL?.trim() ||
    "https://gx.dev/upgrade";
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeKey) {
    return `${base}?org=${encodeURIComponent(orgId)}&stripe=1`;
  }
  return `${base}?org=${encodeURIComponent(orgId)}`;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}
