"use client";

import { GetStartedButton } from "@/components/get-started-button";
import { SignInLink } from "@/components/sign-in-link";
import { UserMenu } from "@/components/user-menu";
import { authClient } from "@/lib/auth-client";

const navLinkClassName =
  "text-sm text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";

export function HeaderAuthActions() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div
        className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
        aria-hidden="true"
      />
    );
  }

  if (session?.user) {
    return <UserMenu user={session.user} />;
  }

  return (
    <>
      <SignInLink className={`${navLinkClassName} hidden sm:inline`} />
      <div className="hidden sm:block">
        <GetStartedButton className="ml-1 px-3.5 py-1.5 text-xs sm:ml-2 sm:px-4 sm:py-2" />
      </div>
    </>
  );
}
