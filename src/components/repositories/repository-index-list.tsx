"use client";

import Link from "next/link";
import { GitBranch, Lock, Unlock } from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { SignInLink } from "@/components/sign-in-link";
import { cn } from "@/lib/utils";

type IndexedRepo = {
  id: string;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
  indexStatus: string | null;
};

function formatIndexStatus(status: string | null) {
  if (!status) return "Not indexed";
  return status.replace(/_/g, " ");
}

function statusClass(status: string | null) {
  if (status === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300";
  }

  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300";
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";
}

function RepositoryRow({ repo }: { repo: IndexedRepo }) {
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
      <span
        className={cn(
          "inline-flex w-fit shrink-0 items-center border px-2 py-1 text-xs font-medium capitalize",
          statusClass(repo.indexStatus),
        )}
      >
        {formatIndexStatus(repo.indexStatus)}
      </span>
    </li>
  );
}

export function RepositoryIndexList() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const repos = useQuery(
    api.repos.getMyConnectedRepos,
    isAuthenticated ? {} : "skip",
  );

  if (!isLoading && !isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-2xl border border-zinc-200 px-4 py-8 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <SignInLink className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:text-zinc-300" />{" "}
        to view indexed repositories.
      </div>
    );
  }

  if (isLoading || repos === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="h-20 animate-pulse bg-zinc-100 dark:bg-zinc-900" />
        <div className="space-y-2 border border-zinc-200 p-4 dark:border-zinc-800">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse bg-zinc-100 dark:bg-zinc-900"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Repositories
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Indexed repositories
          </h1>
        </div>
        <Link
          href="/onboarding"
          className="inline-flex items-center justify-center gap-2 border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <GitBranch className="h-4 w-4" />
          Add repositories
        </Link>
      </div>

      {repos.length === 0 ? (
        <div className="border border-zinc-200 px-4 py-8 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No repositories indexed yet.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {repos.map((repo) => (
            <RepositoryRow key={repo.id} repo={repo} />
          ))}
        </ul>
      )}
    </div>
  );
}
