"use client";

import Link from "next/link";
import { AsciiFooterArt } from "@/components/ascii-footer-art";
import { SatoriLogo } from "@/components/satori-logo";
import { authClient } from "@/lib/auth-client";

const DOC_LINKS = [
  { label: "Documentation", href: "#" },
  { label: "API Reference", href: "#" },
  { label: "Guides", href: "#" },
] as const;

const linkClassName =
  "text-sm font-extralight text-white transition-colors hover:text-[var(--footer-link-hover)]";

export function SiteFooter() {
  const { data: session } = authClient.useSession();

  if (session?.user) {
    return null;
  }

  return (
    <footer className="relative mt-auto h-[15.3rem] w-full border-t border-zinc-200 dark:border-zinc-800">
      <AsciiFooterArt className="absolute inset-0 h-full w-full" />

      <div className="relative z-10 flex h-full flex-col justify-between py-6 pl-20 pr-6">
        <nav aria-label="Footer" className="flex flex-col gap-2">
          {DOC_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className={linkClassName}>
              {link.label}
            </Link>
          ))}
          <Link href="#" className={linkClassName}>
            Support
          </Link>
          <a href="mailto:hi@satori.sh" className={linkClassName}>
            hi@satori.sh
          </a>
        </nav>

        <div className="flex items-center gap-2.5">
          <p className="text-xs font-extralight text-white">© 2026</p>
          <SatoriLogo className="shrink-0" />
        </div>
      </div>
    </footer>
  );
}
