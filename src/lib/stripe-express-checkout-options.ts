/** Options for Stripe Express Checkout (Apple Pay / Google Pay buttons). */
export const stripeExpressCheckoutOptions = {
  paymentMethods: {
    applePay: "always",
    googlePay: "always",
    link: "never",
    paypal: "never",
    amazonPay: "never",
    klarna: "never",
  },
  buttonHeight: 48,
} as const;
