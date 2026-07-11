"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  LogOut,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { GitHubIcon } from "@/components/github-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutToHome } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export type UserMenuUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  username?: string | null;
  displayUsername?: string | null;
};

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim())?.trim();
}

function getInitials(name: string) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}

function UserAvatar({
  user,
  displayName,
  size = "sm",
}: {
  user: UserMenuUser;
  displayName: string;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "md" ? "h-10 w-10 text-sm" : "h-7 w-7 text-xs";

  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(sizeClass, "rounded-full object-cover")}
      />
    );
  }

  return (
    <span
      className={cn(
        sizeClass,
        "flex items-center justify-center rounded-full bg-zinc-200 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      )}
    >
      {getInitials(displayName)}
    </span>
  );
}

export function UserMenu({ user }: { user: UserMenuUser }) {
  const [signingOut, setSigningOut] = useState(false);
  const username = firstPresent(user.username, user.displayUsername);
  const displayName = firstPresent(user.name, username, user.email) ?? "User";
  const githubUrl = username ? `https://github.com/${username}` : null;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutToHome();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full border border-zinc-200 p-0.5 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-600"
          aria-label="Open account menu"
        >
          <UserAvatar user={user} displayName={displayName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="border-b border-zinc-100 px-3 py-3 dark:border-zinc-900">
          <div className="flex items-center gap-3">
            <UserAvatar user={user} displayName={displayName} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-5 text-zinc-900 dark:text-zinc-50">
                {displayName}
              </p>
              {username ? (
                <p className="truncate text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">
                  @{username}
                </p>
              ) : null}
              {user.email ? (
                <p className="mt-0.5 truncate text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  {user.email}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <DropdownMenuItem asChild className="cursor-pointer gap-2 text-[13px]">
          <Link href="/profile">
            <UserRound className="h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>

        {githubUrl ? (
          <DropdownMenuItem asChild className="cursor-pointer gap-2 text-[13px]">
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              <GitHubIcon className="h-4 w-4" />
              View GitHub profile
            </a>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
          className="cursor-pointer gap-2 text-[13px]"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
