"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
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

type PullStatusResponse = {
  resolution: "direct" | "canonical" | "missing";
  sourceHeadBranch: string;
  baseBranch: string;
  repoFullName: string;
  remoteBranchExists: boolean;
  canCreatePullRequest: boolean;
  message: string | null;
  status: {
    pullRequestNumber: number;
    pullRequestUrl: string;
    health:
      | "clean"
      | "dirty"
      | "behind"
      | "blocked"
      | "draft"
      | "merged"
      | "unknown"
      | "no_pr";
    label: string;
    canReconcile: boolean;
    headBranch: string;
    checkStatus: "pending" | "success" | "failure" | "none";
    driftStatus?: "in_sync" | "github_ahead" | "gx_ahead" | "unknown";
  } | null;
  canonicalPull: {
    pullRequestNumber: number;
    pullRequestUrl: string;
    headBranch: string;
  } | null;
};

const healthClass: Record<
  NonNullable<PullStatusResponse["status"]>["health"],
  string
> = {
  clean: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  dirty: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  behind:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  blocked:
    "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-300",
  draft: "border-zinc-400/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  merged: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  unknown: "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  no_pr: "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const ciClass: Record<"pending" | "success" | "failure" | "none", string> = {
  pending:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failure: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  none: "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const driftClass: Record<
  "in_sync" | "github_ahead" | "gx_ahead" | "unknown",
  string
> = {
  in_sync:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  github_ahead:
    "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  gx_ahead: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unknown: "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export function PrMergeBar({ bookmark }: PrMergeBarProps) {
  const mergeTarget = useMemo(
    () => extractMergeTarget(bookmark.payload, bookmark.repoFullName),
    [bookmark.payload, bookmark.repoFullName],
  );
  const getPullRequestStatus = useAction(api.gxPrActions.getPullRequestStatus);
  const createPullRequestForPush = useAction(
    api.gxPrActions.createPullRequestForPush,
  );
  const reconcilePullRequest = useAction(
    api.gxPrActions.reconcilePullRequestAction,
  );
  const mergePullRequest = useAction(api.gxPrActions.mergePullRequest);

  const [prStatus, setPrStatus] = useState<PullStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [result, setResult] = useState<{
    kind: "success" | "error";
    message: string;
    pullRequestUrl?: string;
  } | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!mergeTarget) return;
    setIsLoadingStatus(true);
    setStatusError(null);
    try {
      const nextStatus = (await getPullRequestStatus({
        bookmarkId: bookmark.id,
      })) as PullStatusResponse;
      setPrStatus(nextStatus);
    } catch (error) {
      setPrStatus(null);
      setStatusError(
        error instanceof Error ? error.message : "Failed to load PR status.",
      );
    } finally {
      setIsLoadingStatus(false);
    }
  }, [bookmark.id, getPullRequestStatus, mergeTarget]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshStatus]);

  if (!mergeTarget) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
        Cannot merge yet: this bookmark is missing GitHub repo or branch metadata.
      </div>
    );
  }

  const statusHealth = prStatus?.status?.health ?? "unknown";
  const checkStatus = prStatus?.status?.checkStatus ?? "none";
  const driftStatus = prStatus?.status?.driftStatus ?? "unknown";
  const statusLabel =
    prStatus?.status?.label ?? (isLoadingStatus ? "Checking…" : "Unknown");
  const checkLabel =
    checkStatus === "pending"
      ? "CI pending"
      : checkStatus === "success"
        ? "CI pass"
        : checkStatus === "failure"
          ? "CI fail"
          : "CI none";
  const driftLabel =
    driftStatus === "in_sync"
      ? "In sync"
      : driftStatus === "github_ahead"
        ? "GitHub ahead"
        : driftStatus === "gx_ahead"
          ? "GX ahead"
          : "Drift unknown";
  const canOperateOnPull =
    prStatus?.resolution === "direct" || prStatus?.resolution === "canonical";
  const mergeDisabled =
    !canOperateOnPull ||
    isMerging ||
    isReconciling ||
    isCreatingPr ||
    result?.kind === "success" ||
    statusHealth === "dirty" ||
    statusHealth === "behind" ||
    statusHealth === "blocked" ||
    statusHealth === "merged" ||
    statusHealth === "no_pr";

  async function handleCreatePr() {
    if (!mergeTarget) return;
    setIsCreatingPr(true);
    setResult(null);
    try {
      const nextStatus = (await createPullRequestForPush({
        bookmarkId: bookmark.id,
      })) as PullStatusResponse;
      setPrStatus(nextStatus);
      setResult({
        kind: "success",
        message: `Created draft PR for ${mergeTarget.headBranch}.`,
        pullRequestUrl: nextStatus.status?.pullRequestUrl,
      });
    } catch (error) {
      setResult({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to create pull request.",
      });
    } finally {
      setIsCreatingPr(false);
    }
  }

  async function handleReconcile() {
    if (!mergeTarget) return;
    setIsReconciling(true);
    setResult(null);
    try {
      const nextStatus = (await reconcilePullRequest({
        bookmarkId: bookmark.id,
      })) as PullStatusResponse;
      setPrStatus(nextStatus);
      setResult({
        kind: "success",
        message: `Reconciled PR #${nextStatus.status?.pullRequestNumber}. Status is now ${nextStatus.status?.label ?? "updated"}.`,
        pullRequestUrl: nextStatus.status?.pullRequestUrl,
      });
    } catch (error) {
      setResult({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to reconcile pull request.",
      });
      await refreshStatus();
    } finally {
      setIsReconciling(false);
    }
  }

  async function handleMerge() {
    if (!mergeTarget) return;
    setIsMerging(true);
    setResult(null);
    try {
      const response = await mergePullRequest({ bookmarkId: bookmark.id });
      setResult({
        kind: "success",
        message:
          response.resolution === "canonical"
            ? `Merged canonical PR #${response.pullRequestNumber} (${response.headBranch}) for work tracked on ${response.sourceHeadBranch}.`
            : response.markedReady
              ? `Marked PR #${response.pullRequestNumber} ready and merged into ${response.baseBranch}.`
              : `Merged PR #${response.pullRequestNumber} into ${response.baseBranch}.`,
        pullRequestUrl: response.pullRequestUrl,
      });
      await refreshStatus();
    } catch (error) {
      setResult({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Failed to merge pull request.",
      });
      await refreshStatus();
    } finally {
      setIsMerging(false);
    }
  }

  const pullUrl =
    prStatus?.status?.pullRequestUrl ??
    prStatus?.canonicalPull?.pullRequestUrl ??
    mergeTarget.pullRequestUrl;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${healthClass[statusHealth]}`}
          >
            {statusLabel}
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
          {prStatus?.resolution === "canonical" ? (
            <span className="text-xs text-zinc-500">Review body · merge via canonical PR</span>
          ) : null}
        </div>
        <div className="space-y-0.5">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {mergeTarget.repoFullName}
          </p>
          <p className="font-mono text-xs text-zinc-500">
            {mergeTarget.headBranch} → {mergeTarget.baseBranch}
          </p>
          {pullUrl ? (
            <Link
              href={pullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              GitHub PR #
              {prStatus?.status?.pullRequestNumber ??
                prStatus?.canonicalPull?.pullRequestNumber ??
                mergeTarget.pullRequestNumber ??
                "?"}
            </Link>
          ) : null}
        </div>
        {prStatus?.message ? (
          <p className="max-w-xl text-xs text-zinc-600 dark:text-zinc-400">
            {prStatus.message}
          </p>
        ) : null}
        {statusError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{statusError}</p>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          {prStatus?.canCreatePullRequest ? (
            <Button
              type="button"
              variant="secondary"
              disabled={isCreatingPr || isMerging || isReconciling}
              onClick={() => void handleCreatePr()}
            >
              {isCreatingPr ? "Creating PR…" : "Create PR"}
            </Button>
          ) : null}
          {prStatus?.status?.canReconcile ? (
            <Button
              type="button"
              variant="secondary"
              disabled={isReconciling || isMerging || isCreatingPr}
              onClick={() => void handleReconcile()}
            >
              {isReconciling ? "Reconciling…" : "Reconcile"}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={mergeDisabled}
            onClick={() => void handleMerge()}
          >
            {isMerging
              ? "Merging…"
              : result?.kind === "success"
                ? "Merged"
                : prStatus?.resolution === "canonical"
                  ? `Merge PR #${prStatus.canonicalPull?.pullRequestNumber ?? prStatus.status?.pullRequestNumber}`
                  : `Merge into ${mergeTarget.baseBranch}`}
          </Button>
        </div>
        {result ? (
          <p
            className={`max-w-sm text-right text-xs ${
              result.kind === "success"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {result.message}
            {result.pullRequestUrl ? (
              <>
                {" "}
                <Link
                  href={result.pullRequestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Open PR
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
