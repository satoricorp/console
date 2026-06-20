import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import { SIGNED_IN_HOME_URL } from "@/lib/site-links";

export default async function WelcomePage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }

  redirect(SIGNED_IN_HOME_URL);
}
