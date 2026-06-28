"use client";

/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Mail } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { GitHubIcon } from "@/components/github-icon";
import { authClient } from "@/lib/auth-client";

type Profile = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    username: string | null;
    displayUsername: string | null;
    createdAt: number | null;
  };
  connectedRepoCount: number;
};

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim())?.trim();
}

function getInitials(name: string) {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}

function UserAvatar({
  image,
  displayName,
}: {
  image: string | null;
  displayName: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        referrerPolicy="no-referrer"
        className="h-16 w-16 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-lg font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {getInitials(displayName)}
    </span>
  );
}

function ProfileContent({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const username = firstPresent(
    profile.user.username,
    profile.user.displayUsername,
  );
  const displayName =
    firstPresent(profile.user.name, username, profile.user.email) ?? "User";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.replace("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className="flex flex-col gap-5 pb-2">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar image={profile.user.image} displayName={displayName} />
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {displayName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              {username ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <GitHubIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">@{username}</span>
                </span>
              ) : null}
              {profile.user.email ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="truncate">{profile.user.email}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {profile.connectedRepoCount} connected{" "}
        {profile.connectedRepoCount === 1 ? "repository" : "repositories"}.
      </p>

      <div className="flex justify-start">
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className="inline-flex items-center justify-center border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}

export function ProfileHome() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const profile = useQuery(
    api.profile.getMyProfile,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || profile === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="h-24 animate-pulse bg-zinc-100 dark:bg-zinc-900" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse bg-zinc-100 dark:bg-zinc-900"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-2xl border border-zinc-200 px-4 py-8 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Sign in to view your profile.
      </div>
    );
  }

  return <ProfileContent profile={profile} />;
}
