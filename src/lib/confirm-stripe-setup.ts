import type { Stripe, StripeElements } from "@stripe/stripe-js";

/** Confirm a SetupIntent whose client secret was passed to Elements on mount. */
export async function confirmStripeSetupIntent(
  stripe: Stripe,
  elements: StripeElements,
  returnUrl: string,
): Promise<{ paymentMethodId: string } | { error: string }> {
  const { error: submitError } = await elements.submit();
  if (submitError) {
    return { error: submitError.message ?? "Could not verify payment details" };
  }

  const { error: confirmError, setupIntent } = await stripe.confirmSetup({
    elements,
    confirmParams: { return_url: returnUrl },
    redirect: "if_required",
  });

  if (confirmError) {
    return { error: confirmError.message ?? "Could not save payment method" };
  }

  const paymentMethodId =
    typeof setupIntent?.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent?.payment_method?.id;

  if (!paymentMethodId) {
    return { error: "Could not verify payment method. Try again." };
  }

  return { paymentMethodId };
}
