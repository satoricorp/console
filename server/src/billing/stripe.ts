/** Stripe billing stub — checkout URL placeholder until WP-5f full integration. */

export function getUpgradeCheckoutUrl(orgId: string): string {
  // No dedicated upgrade page exists yet; land on the site root rather
  // than a 404. Override with GX_UPGRADE_URL once pricing ships.
  const base =
    process.env.GX_UPGRADE_URL?.trim() ||
    "https://gx.run";
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeKey) {
    return `${base}?org=${encodeURIComponent(orgId)}&stripe=1`;
  }
  return `${base}?org=${encodeURIComponent(orgId)}`;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}
