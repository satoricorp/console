"use client";

import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/button";

export type PullRequestCardData = {
  id: Id<"gxPullRequests">;
  requestId: string;
  createdAt: number;
  updatedAt: number;
  gxVersion?: string;
  repoRootPath?: string;
  repoBackend?: string;
  repoRemoteUrl?: string;
  repoBranchName?: string;
  headCommitId?: string;
  githubPullRequestUrl?: string;
  title?: string;
  description?: string;
  status?: string;
  addCount: number;
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function repoLabel(pr: PullRequestCardData) {
  if (pr.repoRemoteUrl) return pr.repoRemoteUrl.replace(/^git@github.com:/, "github.com/");
  return pr.repoRootPath ?? "Unknown repository";
}

export function PrCard({
  pr,
  debugEnabled,
  onInspect,
}: {
  pr: PullRequestCardData;
  debugEnabled: boolean;
  onInspect: (id: Id<"gxPullRequests">) => void;
}) {
  return (
    <article className="flex flex-col gap-4 border border-zinc-200 p-5 text-left dark:border-zinc-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {repoLabel(pr)}
          </p>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {pr.title ?? pr.description ?? "Untitled GX PR"}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {pr.repoBranchName ? `${pr.repoBranchName} · ` : ""}
            {pr.addCount} {pr.addCount === 1 ? "add" : "adds"} ·{" "}
            {formatDate(pr.createdAt)}
          </p>
        </div>
        {pr.status ? (
          <span className="w-fit border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            {pr.status}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {debugEnabled ? (
          <Button variant="secondary" onClick={() => onInspect(pr.id)}>
            Inspect data
          </Button>
        ) : null}
        {pr.githubPullRequestUrl ? (
          <a
            href={pr.githubPullRequestUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
          >
            Open GitHub PR
          </a>
        ) : null}
        {pr.headCommitId ? (
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
            {pr.headCommitId.slice(0, 12)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
