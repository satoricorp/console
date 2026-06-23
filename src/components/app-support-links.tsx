"use client";

import { DiscordIcon } from "@/components/discord-icon";
import { DISCORD_URL, SUPPORT_EMAIL, SUPPORT_EMAIL_URL } from "@/lib/site-links";

export function AppSupportLinks() {
  return (
    <div className="fixed bottom-4 right-5 z-40 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500 sm:right-10">
      <a
        href={DISCORD_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-950 dark:hover:text-zinc-100"
      >
        <DiscordIcon className="h-3.5 w-3.5" />
        Discord
      </a>
      <a
        href={SUPPORT_EMAIL_URL}
        className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-100"
      >
        {SUPPORT_EMAIL}
      </a>
    </div>
  );
}
