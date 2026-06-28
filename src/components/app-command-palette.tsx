"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { authClient } from "@/lib/auth-client";
import { DISCORD_URL, SUPPORT_EMAIL_URL } from "@/lib/site-links";

const commandItemClass =
  "justify-between gap-4 text-zinc-100 data-[selected=true]:bg-zinc-900 data-[selected=true]:text-white";

function CommandShortcut({ children }: { children: string }) {
  return (
    <kbd className="ml-auto shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-500">
      {children}
    </kbd>
  );
}

function handlePaletteNavigation(event: ReactKeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (event.key !== "j" && event.key !== "k") return;
  if (
    event.target instanceof HTMLInputElement &&
    event.target.value.trim() !== ""
  ) {
    return;
  }

  event.preventDefault();
  event.currentTarget.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: event.key === "j" ? "ArrowDown" : "ArrowUp",
      bubbles: true,
    }),
  );
}

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

  const runCommand = useCallback((path: string) => {
    setOpen(false);
    router.push(path);
  }, [router]);

  const runExternal = useCallback((url: string) => {
    setOpen(false);
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const runSignOut = useCallback(async () => {
    setOpen(false);
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!open) return;

    function handleCommandShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;

      const key = event.key.toLowerCase();
      if (key === "d") {
        event.preventDefault();
        runCommand("/download");
      }
      if (key === "j") {
        event.preventDefault();
        runExternal(DISCORD_URL);
      }
      if (key === "e") {
        event.preventDefault();
        runExternal(SUPPORT_EMAIL_URL);
      }
    }

    window.addEventListener("keydown", handleCommandShortcut);
    return () => window.removeEventListener("keydown", handleCommandShortcut);
  }, [open, runCommand, runExternal]);

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
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-zinc-900 bg-zinc-950 shadow-2xl outline-none">
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>
          <Command
            className="bg-zinc-950 text-zinc-50"
            onKeyDown={handlePaletteNavigation}
          >
            <CommandInput
              placeholder="Search commands..."
              autoFocus
              showSearchIcon={false}
              wrapperClassName="border-zinc-800 px-4"
              className="text-zinc-50 placeholder:text-zinc-500"
            />
            <CommandList>
              <CommandEmpty>No command found.</CommandEmpty>
              <CommandGroup heading="Workspace" className="text-zinc-50">
                <CommandItem
                  value="repositories github repos"
                  onSelect={() => runCommand("/repositories")}
                  className={commandItemClass}
                >
                  <span>Repositories</span>
                </CommandItem>
                <CommandItem
                  value="devices cli signed in machines"
                  onSelect={() => runCommand("/devices")}
                  className={commandItemClass}
                >
                  <span>Devices</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator className="bg-zinc-900" />
              <CommandGroup heading="Setup" className="text-zinc-50">
                <CommandItem
                  value="download gx"
                  onSelect={() => runCommand("/download")}
                  className={commandItemClass}
                >
                  <span>Download</span>
                  <CommandShortcut>⌘D</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator className="bg-zinc-900" />
              <CommandGroup heading="Support" className="text-zinc-50">
                <CommandItem
                  value="discord community support"
                  onSelect={() => runExternal(DISCORD_URL)}
                  className={commandItemClass}
                >
                  <span>Join Discord</span>
                  <CommandShortcut>⌘J</CommandShortcut>
                </CommandItem>
                <CommandItem
                  value="email contact support hi satori"
                  onSelect={() => runExternal(SUPPORT_EMAIL_URL)}
                  className={commandItemClass}
                >
                  <span>Email Us</span>
                  <CommandShortcut>⌘E</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator className="bg-zinc-900" />
              <CommandGroup heading="Account" className="text-zinc-50">
                <CommandItem
                  value="profile account settings"
                  onSelect={() => runCommand("/profile")}
                  className={commandItemClass}
                >
                  <span>Profile</span>
                </CommandItem>
                <CommandItem
                  value="sign out logout account"
                  onSelect={() => void runSignOut()}
                  className={commandItemClass}
                >
                  <span>Sign Out</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
