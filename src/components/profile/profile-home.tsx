"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import type { ComponentType } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ExternalLink,
  GitBranch,
  Lock,
  Mail,
  Unlock,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { GitHubIcon } from "@/components/github-icon";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

type ProfileRepo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string | null;
  connectedAt: number;
  accessVerifiedAt: number;
  indexStatus: string | null;
};

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
  repos: ProfileRepo[];
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

function formatIndexStatus(status: string | null) {
  if (!status) return "Not indexed";
  return status.replace(/_/g, " ");
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

function ActionLink({
  href,
  icon: Icon,
  label,
  external = false,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  external?: boolean;
}) {
  const className =
    "inline-flex items-center justify-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        <Icon className="h-4 w-4" />
        {label}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function ProfileContent({ profile }: { profile: Profile }) {
  const username = firstPresent(
    profile.user.username,
    profile.user.displayUsername,
  );
  const displayName =
    firstPresent(profile.user.name, username, profile.user.email) ?? "User";
  const githubUrl = username ? `https://github.com/${username}` : null;
  const recentRepos = profile.repos.slice(0, 6);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <section className="flex flex-col gap-5 pb-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar image={profile.user.image} displayName={displayName} />
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Profile
            </p>
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

        <div className="flex flex-wrap gap-2">
          <ActionLink href="/repositories" icon={GitBranch} label="Repositories" />
          {githubUrl ? (
            <ActionLink
              href={githubUrl}
              icon={GitHubIcon}
              label="GitHub"
              external
            />
          ) : null}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {profile.connectedRepoCount} connected{" "}
            {profile.connectedRepoCount === 1 ? "repository" : "repositories"}
          </h2>
          <Link
            href="/repositories"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Manage
          </Link>
        </div>

        {recentRepos.length === 0 ? (
          <div className="py-8 text-sm text-zinc-600 dark:text-zinc-400">
            No repositories connected.
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {recentRepos.map((repo) => (
              <li
                key={repo.id}
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {repo.fullName}
                    </span>
                    {repo.private ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {repo.defaultBranch ? `${repo.defaultBranch} branch` : "Default branch unavailable"}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center border px-2 py-1 text-xs font-medium capitalize",
                      repo.indexStatus === "ready"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
                    )}
                  >
                    {formatIndexStatus(repo.indexStatus)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
