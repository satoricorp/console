"use client";

import { GetStartedButton } from "@/components/get-started-button";
import { SignInLink } from "@/components/sign-in-link";
import { authClient } from "@/lib/auth-client";

const navLinkClassName =
  "text-sm text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";

export function HeaderAuthActions() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending || session) {
    return null;
  }

  return (
    <>
      <SignInLink className={`${navLinkClassName} hidden sm:inline`} />
      <GetStartedButton className="ml-1 px-3.5 py-1.5 text-xs sm:ml-2 sm:px-4 sm:py-2" />
    </>
  );
}
