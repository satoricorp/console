"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Lock,
  Unlock,
} from "lucide-react";
import { useMemo, useState } from "react";
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

const REPOS_PER_PAGE = 9;

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
          {repo.defaultBranch
            ? `${repo.defaultBranch} branch`
            : "Default branch unavailable"}
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
  const [page, setPage] = useState(1);
  const repos = useQuery(
    api.repos.getMyConnectedRepos,
    isAuthenticated ? {} : "skip",
  );
  const pageCount = repos ? Math.ceil(repos.length / REPOS_PER_PAGE) : 1;
  const showPagination = pageCount > 1;
  const currentPage = Math.min(page, Math.max(pageCount, 1));
  const paginatedRepos = useMemo(() => {
    if (!repos) return [];
    const start = (currentPage - 1) * REPOS_PER_PAGE;
    return repos.slice(start, start + REPOS_PER_PAGE);
  }, [currentPage, repos]);

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
      {repos.length === 0 ? (
        <div className="border border-zinc-200 px-4 py-8 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No repositories indexed yet.
        </div>
      ) : (
        <div className="border border-zinc-200 dark:border-zinc-800">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {paginatedRepos.map((repo) => (
              <RepositoryRow key={repo.id} repo={repo} />
            ))}
          </ul>

          {showPagination ? (
            <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {currentPage} of {pageCount}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  aria-label="Previous repositories page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={currentPage === pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(current + 1, pageCount))
                  }
                  className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  aria-label="Next repositories page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href="/onboarding"
          className="inline-flex items-center justify-center gap-2 border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <GitBranch className="h-4 w-4" />
          Add repositories
        </Link>
      </div>
    </div>
  );
}
