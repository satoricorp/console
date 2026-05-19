"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { GxLogo } from "@/components/gx-logo";
import { UserMenu } from "@/components/user-menu";

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <header className="flex items-center justify-between gap-4 overflow-visible border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <Link
        href="/"
        className="flex shrink-0 items-center"
        aria-label="Console home"
      >
        <GxLogo variant="header" />
      </Link>
      {isPending ? (
        <div className="h-9 w-28 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      ) : session?.user ? (
        <UserMenu />
      ) : (
        <AuthButton />
      )}
    </header>
  );
}
