/**
 * Where a user goes to subscribe once their free runs are spent. The page
 * itself (console /checkout) signs them in and hands them to Stripe Checkout;
 * the server only ever needs the address.
 */
export function getCheckoutUrl(): string {
  const site = (
    process.env.GX_SITE_URL?.trim() ||
    process.env.CONSOLE_SITE_URL?.trim() ||
    "https://gx.run"
  ).replace(/\/+$/, "");
  return `${site}/checkout`;
}
