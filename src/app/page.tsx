"use client";

import { authClient } from "@/lib/auth-client";
import { AuthButton } from "@/components/auth-button";

export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        {isPending ? (
          <div className="h-20 w-64 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        ) : session?.user ? (
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Welcome back
              {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Use the menu in the header to view your profile or sign out.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Welcome
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Sign in with GitHub to get started. Your profile appears in the
                header once you are authenticated.
              </p>
            </div>
            <AuthButton />
          </>
        )}
      </div>
    </main>
  );
}
