"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Dark-only copy chip for the v2 landing. The page forces a dark canvas in
 * both OS themes, so this intentionally skips `dark:` variants.
 */
export function InstallCommand({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const Icon = copied ? Check : Copy;

  return (
    <div
      className={cn(
        "flex min-h-9 items-center gap-3 border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-300",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs">
        <span className="mr-2 select-none text-zinc-600">$</span>
        {command}
      </code>
      <button
        type="button"
        onClick={copyCommand}
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-zinc-500 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
        aria-label={copied ? "Copied command" : "Copy command"}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
