import type { StripePaymentElementOptions } from "@stripe/stripe-js";

/** Card fields plus Apple Pay / Google Pay wallets (no Link bank, ACH, etc.). */
export const stripePaymentElementOptions: StripePaymentElementOptions = {
  paymentMethodOrder: ["card"],
  wallets: {
    applePay: "auto",
    googlePay: "auto",
    link: "never",
  },
};
