"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, GitBranch, Mail, UserRound, X } from "lucide-react";
import { DiscordIcon } from "@/components/discord-icon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DISCORD_URL, SUPPORT_EMAIL_URL } from "@/lib/site-links";

const commandItemClass =
  "text-zinc-100 data-[selected=true]:bg-zinc-900 data-[selected=true]:text-white";

export function AppCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function runCommand(path: string) {
    setOpen(false);
    router.push(path);
  }

  function runExternal(url: string) {
    setOpen(false);
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-none bg-transparent px-2 text-sm text-zinc-600 transition-colors hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-600"
          aria-label="Open command palette"
        >
          <kbd className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            ⌘K
          </kbd>
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-zinc-950/[0.85]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-zinc-950 shadow-2xl outline-none">
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>
          <Command className="bg-zinc-950 text-zinc-50">
            <CommandInput
              placeholder="Search commands..."
              autoFocus
              showSearchIcon={false}
              wrapperClassName="border-zinc-800 px-4"
              className="text-zinc-50 placeholder:text-zinc-500"
            />
            <CommandList>
              <CommandEmpty>No command found.</CommandEmpty>
              <CommandGroup className="text-zinc-50">
                <CommandItem
                  value="repositories github repos"
                  onSelect={() => runCommand("/repositories")}
                  className={commandItemClass}
                >
                  <GitBranch className="h-4 w-4" />
                  <span>Repositories</span>
                </CommandItem>
                <CommandItem
                  value="profile account settings"
                  onSelect={() => runCommand("/profile")}
                  className={commandItemClass}
                >
                  <UserRound className="h-4 w-4" />
                  <span>Profile</span>
                </CommandItem>
                <CommandItem
                  value="download gx"
                  onSelect={() => runCommand("/download")}
                  className={commandItemClass}
                >
                  <Download className="h-4 w-4" />
                  <span>Download GX</span>
                </CommandItem>
                <CommandItem
                  value="discord community support"
                  onSelect={() => runExternal(DISCORD_URL)}
                  className={commandItemClass}
                >
                  <DiscordIcon className="h-4 w-4" />
                  <span>Discord</span>
                </CommandItem>
                <CommandItem
                  value="email contact support hi satori"
                  onSelect={() => runExternal(SUPPORT_EMAIL_URL)}
                  className={commandItemClass}
                >
                  <Mail className="h-4 w-4" />
                  <span>Email support</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogPrimitive.Close className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
