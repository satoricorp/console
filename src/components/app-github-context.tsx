"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";
import { GitHubIcon } from "@/components/github-icon";
import { api } from "../../convex/_generated/api";

function firstPresent(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim())?.trim();
}

function defaultGithubContext(
  profile: NonNullable<ReturnType<typeof useQuery<typeof api.profile.getMyProfile>>>,
) {
  const ownerCounts = new Map<string, number>();
  for (const repo of profile.repos) {
    ownerCounts.set(repo.owner, (ownerCounts.get(repo.owner) ?? 0) + 1);
  }

  const topOwner = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return firstPresent(topOwner, profile.user.displayUsername, profile.user.username);
}

export function AppGithubContext() {
  const { isAuthenticated } = useConvexAuth();
  const profile = useQuery(
    api.profile.getMyProfile,
    isAuthenticated ? {} : "skip",
  );

  if (!profile) return null;

  const contextName = defaultGithubContext(profile);
  if (!contextName) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl items-center pb-5">
      <Link
        href="/repositories"
        className="inline-flex min-w-0 items-center gap-2 text-sm text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <GitHubIcon className="h-4 w-4 shrink-0" />
        <span className="truncate font-medium text-zinc-950 dark:text-zinc-100">
          {contextName}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0" />
        repositories
      </Link>
    </div>
  );
}
