import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import { DISCORD_URL } from "@/lib/site-links";

export default async function WelcomePage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-stretch gap-6 text-center">
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            Thanks for signing in
          </p>
          <h1 className="text-pretty text-2xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            We&apos;ll reach out when we open more seats.
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            GX is in a limited early access period. You&apos;re on the list —
            we&apos;ll email you as soon as we can invite you in.
          </p>
        </div>

        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Questions while you wait?{" "}
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:text-zinc-100"
          >
            Join us on Discord
          </a>
          .
        </p>
      </div>
    </main>
  );
}
