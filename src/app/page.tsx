import { redirect } from "next/navigation";
import { SignedOutLanding } from "@/components/home/signed-out-landing";
import { isAuthenticated } from "@/lib/auth-server";
import { POST_SIGN_IN_URL } from "@/lib/site-links";

export default async function Home() {
  if (await isAuthenticated()) {
    redirect(POST_SIGN_IN_URL);
  }

  return <SignedOutLanding />;
}
