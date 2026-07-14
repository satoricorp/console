import { redirect } from "next/navigation";
import { SignedOutLanding } from "@/components/home/signed-out-landing";
import { isAuthenticated } from "@/lib/auth-server";
import { SIGNED_IN_HOME_URL } from "@/lib/site-links";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  if ((await searchParams).demo === "1") {
    redirect("/reviews?demo=1");
  }

  if (await isAuthenticated()) {
    redirect(SIGNED_IN_HOME_URL);
  }

  return <SignedOutLanding />;
}
