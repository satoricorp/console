"use client";

import { useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { GitHubIcon } from "@/components/github-icon";

type SessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  username?: string | null;
  displayUsername?: string | null;
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserMenu() {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (isPending) {
    return (
      <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
    );
  }

  const user = session?.user as SessionUser | undefined;
  if (!user) return null;

  const displayName = user.name ?? user.email ?? "User";
  const username = user.username ?? user.displayUsername;
  const githubUrl = username ? `https://github.com/${username}` : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-zinc-200 py-1 pl-1 pr-2.5 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {user.image ? (
          <img
            src={user.image}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {getInitials(displayName)}
          </span>
        )}
        <span className="max-w-32 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {displayName}
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="border-b border-zinc-100 px-3 py-3 dark:border-zinc-900">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {displayName}
            </p>
            {username ? (
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                @{username}
              </p>
            ) : null}
            {user.email ? (
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {user.email}
              </p>
            ) : null}
          </div>

          <a
            role="menuitem"
            href="/billing"
            onClick={() => setOpen(false)}
            className="flex w-full rounded-lg px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Billing
          </a>

          {githubUrl ? (
            <a
              role="menuitem"
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <GitHubIcon className="h-4 w-4" />
              View GitHub profile
            </a>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void authClient.signOut();
            }}
            className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
