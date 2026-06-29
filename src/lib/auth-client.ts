import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [convexClient()],
});

export async function signOutToHome() {
  const { error } = await authClient.signOut();
  if (error) {
    throw new Error(
      typeof error.message === "string" ? error.message : "Failed to sign out",
    );
  }
  window.location.assign("/");
}
