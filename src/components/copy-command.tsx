"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type CopyCommandProps = {
  command: string;
  onCopy?: () => void;
};

export function CopyCommand({ command, onCopy }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    onCopy?.();
    window.setTimeout(() => setCopied(false), 1500);
  }

  const Icon = copied ? Check : Copy;

  return (
    <div className="flex min-h-9 items-center gap-3 bg-zinc-100 px-2.5 py-1.5 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs">
        {command}
      </code>
      <button
        type="button"
        onClick={copyCommand}
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-zinc-500 transition-colors hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-600"
        aria-label={copied ? "Copied command" : "Copy command"}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
