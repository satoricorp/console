/** Stripe trial signup UI and actions are enabled only when explicitly set to "true". */
export function isStripeSignupEnabled() {
  return process.env.NEXT_PUBLIC_STRIPE_SIGNUP_ENABLED === "true";
}
