"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";
import { UserMenu } from "@/components/user-menu";

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
      >
        Console
      </Link>
      {isPending ? (
        <div className="h-9 w-28 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      ) : session?.user ? (
        <UserMenu />
      ) : (
        <AuthButton />
      )}
    </header>
  );
}
