import type { Stripe, StripeElements } from "@stripe/stripe-js";

/**
 * Deferred SetupIntent flow: collect payment in Elements (mode: setup), create
 * the SetupIntent on the server, then confirm. Required for Apple/Google Pay.
 */
export async function confirmStripeSetupIntent(
  stripe: Stripe,
  elements: StripeElements,
  returnUrl: string,
  fetchClientSecret: () => Promise<string>,
): Promise<{ paymentMethodId: string } | { error: string }> {
  const { error: submitError } = await elements.submit();
  if (submitError) {
    return { error: submitError.message ?? "Could not verify payment details" };
  }

  let clientSecret: string;
  try {
    clientSecret = await fetchClientSecret();
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Could not start payment setup",
    };
  }

  const { error: confirmError, setupIntent } = await stripe.confirmSetup({
    elements,
    clientSecret,
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
