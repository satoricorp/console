"use client";

import { authClient } from "@/lib/auth-client";
import { GitHubIcon } from "@/components/github-icon";

export function AuthButton() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="h-9 w-28 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
    );
  }

  if (session?.user) return null;

  return (
    <button
      type="button"
      onClick={() =>
        authClient.signIn.social({
          provider: "github",
          callbackURL: process.env.NEXT_PUBLIC_SITE_URL,
        })
      }
      className="flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      <GitHubIcon className="h-4 w-4" />
      Sign in
    </button>
  );
}
