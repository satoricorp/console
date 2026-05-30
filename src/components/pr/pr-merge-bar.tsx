"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { extractMergeTarget } from "@/lib/gx-pr-payload";

type PrMergeBarProps = {
  bookmark: {
    id: string;
    latestEventId: string;
    repoFullName: string;
    payload?: unknown;
  };
};

type PublishStatus = {
  repoFullName: string;
  headBranch: string;
  baseBranch: string;
  remoteBranchExists: boolean;
  localHeadSha: string | null;
  remoteHeadSha: string | null;
  driftStatus: "in_sync" | "github_ahead" | "gx_ahead" | "unknown";
  checkStatus: "pending" | "success" | "failure" | "none";
  integratedOnBase: boolean;
  message: string | null;
  canLand: boolean;
  landBlockedReason: string | null;
  branchUrl: string;
  actionsUrl: string;
};

const ciClass: Record<PublishStatus["checkStatus"], string> = {
  pending:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failure: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  none: "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const driftClass: Record<PublishStatus["driftStatus"], string> = {
  in_sync:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  github_ahead:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  gx_ahead: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unknown: "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

async function fetchPublishStatus(
  bookmark: PrMergeBarProps["bookmark"],
  includeCiChecks: boolean,
): Promise<PublishStatus> {
  const params = new URLSearchParams();
  if (includeCiChecks) {
    params.set("include_ci_checks", "1");
  }
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmark.id)}/publish-status?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load publish status.");
  }
  return (await response.json()) as PublishStatus;
}

async function landBookmarkRequest(
  bookmark: PrMergeBarProps["bookmark"],
): Promise<{ baseBranch: string; headBranch: string; sha: string }> {
  const response = await fetch(
    `/api/bookmarks/${encodeURIComponent(bookmark.id)}/land`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to land bookmark.");
  }
  return (await response.json()) as {
    baseBranch: string;
    headBranch: string;
    sha: string;
  };
}

export function PrMergeBar({ bookmark }: PrMergeBarProps) {
  const mergeTarget = useMemo(
    () => extractMergeTarget(bookmark.payload, bookmark.repoFullName),
    [bookmark.payload, bookmark.repoFullName],
  );

  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isLanding, setIsLanding] = useState(false);
  const [result, setResult] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const [ciChecksLoaded, setCiChecksLoaded] = useState(false);

  const refreshStatus = useCallback(
    async (options?: { includeCiChecks?: boolean }) => {
      if (!mergeTarget) return;
      setIsLoadingStatus(true);
      setStatusError(null);
      try {
        const includeCiChecks = options?.includeCiChecks ?? false;
        const nextStatus = await fetchPublishStatus(bookmark, includeCiChecks);
        setPublishStatus(nextStatus);
        if (includeCiChecks) {
          setCiChecksLoaded(true);
        }
      } catch (error) {
        setPublishStatus(null);
        setStatusError(
          error instanceof Error ? error.message : "Failed to load publish status.",
        );
      } finally {
        setIsLoadingStatus(false);
      }
    },
    [bookmark.id, mergeTarget],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshStatus({ includeCiChecks: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (!ciChecksLoaded || publishStatus?.checkStatus !== "pending") {
      return;
    }
    const timer = setInterval(() => {
      void refreshStatus({ includeCiChecks: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [ciChecksLoaded, publishStatus?.checkStatus, refreshStatus]);

  if (!mergeTarget) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
        Cannot publish yet: this bookmark is missing GitHub repo or branch metadata.
      </div>
    );
  }

  const checkStatus = publishStatus?.checkStatus ?? "none";
  const driftStatus = publishStatus?.driftStatus ?? "unknown";
  const integratedOnBase = publishStatus?.integratedOnBase ?? false;
  const checkLabel =
    checkStatus === "pending"
      ? "CI pending"
      : checkStatus === "success"
        ? "CI pass"
        : checkStatus === "failure"
          ? "CI fail"
          : ciChecksLoaded
            ? "No CI"
            : "CI not checked";
  const driftLabel =
    driftStatus === "in_sync"
      ? "In sync"
      : driftStatus === "github_ahead"
        ? "GitHub ahead"
        : driftStatus === "gx_ahead"
          ? "GX ahead"
          : "Drift unknown";
  const publishLabel = integratedOnBase
    ? "Landed on GitHub"
    : publishStatus?.remoteBranchExists
      ? "Branch on GitHub"
      : isLoadingStatus
        ? "Checking…"
        : "Not on GitHub";

  const landBlockedReason =
    publishStatus?.landBlockedReason ??
    (publishStatus && !publishStatus.remoteBranchExists && !integratedOnBase
      ? "Run gx pr from the repo to push this branch to GitHub before landing."
      : null);

  const landDisabled =
    integratedOnBase ||
    isLanding ||
    result?.kind === "success" ||
    Boolean(landBlockedReason);

  async function handleLand() {
    if (!mergeTarget) return;
    setIsLanding(true);
    setResult(null);
    try {
      const response = await landBookmarkRequest(bookmark);
      setResult({
        kind: "success",
        message: `Landed ${response.headBranch} onto ${response.baseBranch} (${response.sha.slice(0, 7)}).`,
      });
      setPublishStatus((current) =>
        current
          ? {
              ...current,
              integratedOnBase: true,
              canLand: false,
              remoteHeadSha: response.sha,
            }
          : current,
      );
    } catch (error) {
      setResult({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Failed to land bookmark.",
      });
    } finally {
      setIsLanding(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-zinc-300/40 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {publishLabel}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ciClass[checkStatus]}`}
          >
            {checkLabel}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${driftClass[driftStatus]}`}
          >
            {driftLabel}
          </span>
          {integratedOnBase ? (
            <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Integrated
            </span>
          ) : null}
        </div>
        <div className="space-y-0.5">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {mergeTarget.repoFullName}
          </p>
          <p className="font-mono text-xs text-zinc-500">
            {mergeTarget.headBranch} → {mergeTarget.baseBranch}
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            {publishStatus?.branchUrl ? (
              <Link
                href={publishStatus.branchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
              >
                Branch on GitHub
              </Link>
            ) : null}
            {publishStatus?.actionsUrl ? (
              <Link
                href={publishStatus.actionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
              >
                GitHub Actions
              </Link>
            ) : null}
          </div>
        </div>
        {publishStatus?.message ? (
          <p className="max-w-xl text-xs text-zinc-600 dark:text-zinc-400">
            {publishStatus.message}
          </p>
        ) : null}
        {statusError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{statusError}</p>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={isLoadingStatus || isLanding}
            onClick={() => void refreshStatus({ includeCiChecks: true })}
          >
            {isLoadingStatus ? "Refreshing…" : "Check CI"}
          </Button>
          <Button type="button" disabled={landDisabled} onClick={() => void handleLand()}>
            {integratedOnBase || result?.kind === "success"
              ? "Landed"
              : isLanding
                ? "Landing…"
                : `Land on ${mergeTarget.baseBranch}`}
          </Button>
        </div>
        {landBlockedReason && result?.kind !== "success" ? (
          <p className="max-w-sm text-right text-xs text-zinc-500">
            {landBlockedReason}
          </p>
        ) : null}
        {result ? (
          <p
            className={`max-w-sm text-right text-xs ${
              result.kind === "success"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
