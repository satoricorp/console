import { redirect } from "next/navigation";
import { SignedOutLanding } from "@/components/home/signed-out-landing";
import { isAuthenticated } from "@/lib/auth-server";
import { SIGNED_IN_HOME_URL } from "@/lib/site-links";

export default async function Home() {
  if (await isAuthenticated()) {
    redirect(SIGNED_IN_HOME_URL);
  }

  return <SignedOutLanding />;
}
