"use client";

import Link from "next/link";
import { GxLogo } from "@/components/gx-logo";
import { SatoriLogo } from "@/components/satori-logo";
import { authClient } from "@/lib/auth-client";
import {
  DISCORD_URL,
  GITHUB_REPO_URL,
  NAV_LINKS,
  SUPPORT_EMAIL,
  SUPPORT_EMAIL_URL,
} from "@/lib/site-links";

const linkClassName =
  "text-xs leading-5 text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-600 dark:hover:text-zinc-950";

const sectionLabelClassName =
  "text-xs font-medium uppercase tracking-[0.08em] text-zinc-500";

export function SiteFooter() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending || session?.user) {
    return null;
  }

  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white text-zinc-950 dark:border-zinc-800 dark:bg-white dark:text-zinc-950">
      <div className="mx-auto max-w-6xl px-5 pt-10 pb-8 sm:px-8 sm:pt-12">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
          <div className="flex w-fit max-w-xs flex-col items-start gap-2.5 text-left">
            <GxLogo variant="footer" tone="graphite" />
            <p className="max-w-[16rem] text-sm leading-6 text-zinc-600">
              The Quality Layer for Agents
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-10 gap-y-8 sm:gap-x-16"
          >
            <div className="space-y-8">
              <div className="space-y-3">
                <p className={sectionLabelClassName}>Product</p>
                <ul className="space-y-2">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={linkClassName}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href="/download" className={linkClassName}>
                      Download
                    </Link>
                  </li>
                </ul>
              </div>

              <div className="space-y-3">
                <p className={sectionLabelClassName}>Community</p>
                <ul className="space-y-2">
                  <li>
                    <a
                      href={GITHUB_REPO_URL}
                      target="_blank"
                      rel="noreferrer"
                      className={linkClassName}
                    >
                      GitHub
                    </a>
                  </li>
                  <li>
                    <a
                      href={DISCORD_URL}
                      target="_blank"
                      rel="noreferrer"
                      className={linkClassName}
                    >
                      Discord
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-3">
              <p className={sectionLabelClassName}>Company</p>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://satori.sh"
                    target="_blank"
                    rel="noreferrer"
                    className={linkClassName}
                  >
                    https://satori.sh
                  </a>
                </li>
                <li>
                  <a href={SUPPORT_EMAIL_URL} className={linkClassName}>
                    {SUPPORT_EMAIL}
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="mt-10 flex items-center gap-2.5 border-t border-zinc-200 pt-5">
          <p className="text-xs font-extralight text-zinc-950">© 2026</p>
          <SatoriLogo fill="#171717" className="shrink-0" />
        </div>
      </div>
    </footer>
  );
}
