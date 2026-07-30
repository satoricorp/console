"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { DiscordIcon } from "@/components/discord-icon";
import { GitHubIcon } from "@/components/github-icon";
import { DISCORD_URL, GITHUB_REPO_URL } from "@/lib/site-links";

const iconLinkClassName =
  "inline-flex h-9 w-9 items-center justify-center text-foreground/70 transition-colors hover:text-foreground";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="font-display text-lg tracking-tight text-foreground"
          >
            TOTALITY
          </Link>

          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center text-foreground"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="site-drawer"
            onClick={() => setOpen(true)}
          >
            <span className="flex w-5 flex-col gap-[5px]" aria-hidden>
              <span className="block h-[1.5px] w-full bg-current" />
              <span className="block h-[1.5px] w-full bg-current" />
            </span>
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="Close menu"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
        />
        <aside
          id="site-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`absolute inset-y-0 right-0 flex w-full max-w-xs flex-col border-l border-foreground/10 bg-background shadow-xl transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-foreground/10 px-5">
            <p id={titleId} className="font-display text-lg tracking-tight">
              TOTALITY
            </p>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center text-foreground"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <span className="relative block h-4 w-4" aria-hidden>
                <span className="absolute left-1/2 top-1/2 block h-[1.5px] w-full -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
                <span className="absolute left-1/2 top-1/2 block h-[1.5px] w-full -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-current" />
              </span>
            </button>
          </div>

          <nav aria-label="Primary" className="flex-1 p-5" />

          <div className="mt-auto flex items-center gap-1 px-5 pb-5">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={iconLinkClassName}
              aria-label="GitHub repository"
            >
              <GitHubIcon className="h-[18px] w-[18px]" />
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              className={iconLinkClassName}
              aria-label="Discord community"
            >
              <DiscordIcon className="h-[18px] w-[18px]" />
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}
