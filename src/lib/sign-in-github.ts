"use client";

import { authClient } from "@/lib/auth-client";
import { POST_SIGN_IN_URL } from "@/lib/site-links";

export async function signInWithGitHub(callbackURL = POST_SIGN_IN_URL) {
  await authClient.signIn.social({
    provider: "github",
    callbackURL,
  });
}
