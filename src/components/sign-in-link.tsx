"use client";

import { POST_SIGN_IN_URL } from "@/lib/site-links";
import { signInWithGitHub } from "@/lib/sign-in-github";

export function SignInLink({
  className,
  callbackURL = POST_SIGN_IN_URL,
}: {
  className?: string;
  callbackURL?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void signInWithGitHub(callbackURL);
      }}
    >
      Sign in
    </button>
  );
}
