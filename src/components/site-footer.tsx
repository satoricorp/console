"use client";

import { AsciiFooterArt } from "@/components/ascii-footer-art";

export function SiteFooter() {
  return (
    <footer className="mt-auto h-48 w-full border-t border-zinc-200 dark:border-zinc-800">
      <AsciiFooterArt className="h-full w-full" />
    </footer>
  );
}
