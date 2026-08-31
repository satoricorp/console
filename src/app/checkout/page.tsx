import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppPage } from "@/components/app-page";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { isAuthenticated } from "@/lib/auth-server";
import { githubSignInUrl } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "gx: Subscribe",
  description: "Keep using gx Cloud AI after your free runs.",
};

/**
 * The URL the CLI and PR Summary print once the free runs are spent. A signed-
 * out visitor goes through GitHub sign-in and lands back here; a signed-in one
 * is sent straight on to Stripe Checkout.
 */
export default async function CheckoutPage() {
  if (!(await isAuthenticated())) {
    redirect(githubSignInUrl("/checkout"));
  }

  return (
    <AppPage>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
        <Suspense fallback={null}>
          <CheckoutFlow />
        </Suspense>
      </div>
    </AppPage>
  );
}
