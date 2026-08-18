import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingV2 } from "@/components/landing-v2/landing";
import { isAuthenticated } from "@/lib/auth-server";
import { REVIEWS_ENABLED } from "@/lib/feature-flags";
import { SIGNED_IN_HOME_URL } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "gx: Code review that knows how the code was written",
  description:
    "gx records the agent session behind each commit and reviews your changes with that context. Findings before you push, summaries and answers in your PR. Plain Git, two commands.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  if (REVIEWS_ENABLED && (await searchParams).demo === "1") {
    redirect("/reviews?demo=1");
  }

  if (await isAuthenticated()) {
    redirect(SIGNED_IN_HOME_URL);
  }

  return <LandingV2 />;
}
