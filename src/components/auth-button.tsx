"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { GitHubIcon } from "@/components/github-icon";

export function AuthButton() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="h-9 w-32 animate-pulse rounded-none bg-zinc-200 dark:bg-zinc-800" />
    );
  }

  if (session?.user) return null;

  return (
    <Button
      onClick={() =>
        authClient.signIn.social({
          provider: "github",
          callbackURL: process.env.NEXT_PUBLIC_SITE_URL,
        })
      }
    >
      <GitHubIcon className="h-4 w-4" />
      Sign in
    </Button>
  );
}
