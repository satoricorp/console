"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocNavEntry } from "@/lib/docs-content";

export function DocsSidebar({ entries }: { entries: DocNavEntry[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation">
      {entries.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          data-active={pathname === entry.href}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}
