"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/button";
import {
  DEFAULT_APPROVAL_THRESHOLD_PERCENT,
  payloadForStackChange,
  reviewMapFromRecords,
  stackChangeFromPayload,
} from "@/lib/gx-stack";
import type { ChatPin } from "@/lib/chat-pin";
import { PrPushPreview } from "./pr-push-preview";

type StackBookmarkLink = {
  id: string;
  branchName: string;
  title?: string;
};

type PrStackReviewProps = {
  bookmarkId: string;
  repoFullName: string;
  payload: unknown;
  stackBookmarks: StackBookmarkLink[];
  onAddChatPin?: (pin: ChatPin) => void;
};

function changeTitle(description: string, fallback: string) {
  const firstLine = description.split("\n")[0]?.trim();
  return firstLine || fallback;
}

export function PrStackReview({
  bookmarkId,
  repoFullName,
  payload,
  stackBookmarks,
  onAddChatPin,
}: PrStackReviewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stackReview = useQuery(api.gxChangeReviews.getStackReviewStatus, {
    bookmarkId,
  });
  const upsertReview = useMutation(api.gxChangeReviews.upsertChangeReview);

  const [approvalPercent, setApprovalPercent] = useState(
    DEFAULT_APPROVAL_THRESHOLD_PERCENT,
  );
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const changes = stackReview?.changes ?? [];
  const reviews = useMemo(
    () => reviewMapFromRecords(stackReview?.reviews ?? []),
    [stackReview?.reviews],
  );
  const threshold =
    stackReview?.approvalThresholdPercent ?? DEFAULT_APPROVAL_THRESHOLD_PERCENT;

  const selectedJjChangeId = useMemo(() => {
    const fromUrl = searchParams.get("change");
    if (fromUrl && changes.some((change) => change.jjChangeId === fromUrl)) {
      return fromUrl;
    }
    return changes[0]?.jjChangeId ?? null;
  }, [changes, searchParams]);

  const selectedChange = changes.find(
    (change) => change.jjChangeId === selectedJjChangeId,
  );

  const selectedReview = selectedChange
    ? reviews.get(selectedChange.jjChangeId)
    : undefined;

  useEffect(() => {
    if (!selectedChange) return;
    setApprovalPercent(
      selectedReview?.approvalPercent ?? DEFAULT_APPROVAL_THRESHOLD_PERCENT,
    );
    setNotes(selectedReview?.notes ?? "");
    setSaveError(null);
  }, [selectedChange?.jjChangeId, selectedReview]);

  function setChangeQueryParam(jjChangeId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("bookmark", bookmarkId);
    params.set("change", jjChangeId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function handleSaveReview() {
    if (!selectedChange) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await upsertReview({
        bookmarkId,
        jjChangeId: selectedChange.jjChangeId,
        stackIndex: selectedChange.stackIndex,
        approvalPercent,
        notes: notes.trim() ? notes.trim() : undefined,
      });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save change review.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (stackReview === undefined) {
    return (
      <div className="rounded-lg border border-zinc-200 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800">
        Loading stack review…
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
        No gx add changes found in this bookmark payload.
      </div>
    );
  }

  const previewPayload = selectedChange
    ? payloadForStackChange(
        stackChangeFromPayload(payload, selectedChange.jjChangeId) ?? {
          stackIndex: selectedChange.stackIndex,
          jjChangeId: selectedChange.jjChangeId,
          changeId: selectedChange.changeId,
          description: selectedChange.description,
          branchName: selectedChange.branchName,
          baseBranchName: selectedChange.baseBranchName,
          patch: null,
          githubPullRequestUrl: selectedChange.githubPullRequestUrl,
          files: selectedChange.files,
          currentCommitId: null,
        },
      )
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Stack review
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {stackReview.summary.approvedChanges}/{stackReview.summary.totalChanges}{" "}
              changes at {threshold}%+ · ordered oldest gx add first
            </p>
          </div>
          {stackReview.summary.blockedReason ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {stackReview.summary.blockedReason}
            </p>
          ) : (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              All stack changes approved — ready to merge.
            </p>
          )}
        </div>

        <ul className="flex flex-col gap-1 p-2">
          {changes.map((change) => {
            const review = reviews.get(change.jjChangeId);
            const approved = Boolean(
              review && review.approvalPercent >= threshold,
            );
            const active = change.jjChangeId === selectedJjChangeId;
            const linkedBookmark = stackBookmarks.find(
              (bookmark) => bookmark.branchName === change.branchName,
            );

            return (
              <li key={change.jjChangeId}>
                <div
                  className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
                    active
                      ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setChangeQueryParam(change.jjChangeId)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-zinc-500">
                        #{change.stackIndex + 1}
                      </span>
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {changeTitle(change.description, change.jjChangeId)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          approved
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : review
                              ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                              : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        {review
                          ? `${review.approvalPercent}%${approved ? " approved" : ""}`
                          : "Not reviewed"}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-zinc-500">
                      gx add #{change.changeId} · {change.branchName} →{" "}
                      {change.baseBranchName}
                    </p>
                  </button>
                  {linkedBookmark && linkedBookmark.id !== bookmarkId ? (
                    <Link
                      href={`/?bookmark=${encodeURIComponent(linkedBookmark.id)}&change=${encodeURIComponent(change.jjChangeId)}`}
                      className="text-xs text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                    >
                      Open PR bookmark
                    </Link>
                  ) : null}
                  {change.githubPullRequestUrl ? (
                    <Link
                      href={change.githubPullRequestUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                    >
                      GitHub PR
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {selectedChange ? (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Review change #{selectedChange.stackIndex + 1}
              </p>
              <p className="text-xs text-zinc-500">{repoFullName}</p>
            </div>

            <label className="block space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  Approval
                </span>
                <span className="font-mono text-sm text-zinc-900 dark:text-zinc-50">
                  {approvalPercent}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={approvalPercent}
                disabled={isSaving}
                onChange={(event) =>
                  setApprovalPercent(Number(event.target.value))
                }
                className="w-full"
                aria-label="Approval percentage"
              />
              <div className="flex justify-between text-xs text-zinc-500">
                <span>0% reject</span>
                <span>100% approve</span>
              </div>
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Notes</span>
              <textarea
                value={notes}
                disabled={isSaving}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                placeholder="Review notes (saved to Postgres)"
              />
            </label>

            {saveError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
            ) : null}

            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveReview()}
            >
              {isSaving ? "Saving…" : "Save review"}
            </Button>
          </div>
        </section>
      ) : null}

      {previewPayload ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <PrPushPreview payload={previewPayload} onAddChatPin={onAddChatPin} />
        </div>
      ) : null}
    </div>
  );
}
