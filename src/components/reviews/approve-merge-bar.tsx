"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { userFacingActionError } from "@/lib/convex-action-error";
import {
  recordReviewDecision,
  type ReviewResponse,
} from "@/lib/reviews-client";

type Props = {
  review: ReviewResponse;
  onMerged: () => void;
};

export function ApproveMergeBar({ review, onMerged }: Props) {
  const approveAndMerge = useAction(api.gxPrActions.approveAndMergePullRequest);
  const getPublishStatus = useAction(api.gxPrActions.getPublishStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mergeStatus, setMergeStatus] = useState(review.bookmark.mergeStatus);
  const [ci, setCi] = useState<{
    checkStatus: string;
    message: string | null;
  } | null>(null);

  useEffect(() => {
    setMergeStatus(review.bookmark.mergeStatus);
  }, [review.bookmark.mergeStatus]);

  const prNumber =
    review.publishContext.pullRequestNumber ?? review.bookmark.githubPrNumber;
  const prUrl =
    review.publishContext.pullRequestUrl ?? review.bookmark.githubPrUrl;
  const merged = mergeStatus === "merged";
  const closed = mergeStatus === "closed";
  const canMerge = Boolean(prNumber) && !merged && !closed;

  async function refreshCi() {
    try {
      const status = await getPublishStatus({
        bookmarkId: review.bookmark.id,
        publishContext: {
          repoFullName: review.publishContext.repoFullName,
          headBranch: review.publishContext.headBranch,
          baseBranch: review.publishContext.baseBranch,
          localHeadSha: review.publishContext.localHeadSha,
        },
        includeCiChecks: true,
      });
      setCi({ checkStatus: status.checkStatus, message: status.message });
      return status;
    } catch {
      setCi({ checkStatus: "none", message: null });
      return null;
    }
  }

  async function ensureCi() {
    if (ci) return ci;
    const status = await refreshCi();
    return status
      ? { checkStatus: status.checkStatus, message: status.message }
      : { checkStatus: "none", message: null };
  }

  async function handleApprove() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!prNumber) {
        setError("No GitHub pull request is linked to this review.");
        return;
      }

      const status = await ensureCi();
      if (status.checkStatus === "failure") {
        setError("CI checks are failing. Fix checks before merging.");
        return;
      }
      if (status.checkStatus === "pending") {
        setError("CI checks are still running.");
        return;
      }
      if (status.checkStatus === "none") {
        const ok = window.confirm(
          "No CI checks found for this branch. Approve & merge anyway?",
        );
        if (!ok) return;
      }

      const result = await approveAndMerge({
        bookmarkId: review.bookmark.id,
        publishContext: {
          repoFullName: review.publishContext.repoFullName,
          headBranch: review.publishContext.headBranch,
          baseBranch: review.publishContext.baseBranch,
          localHeadSha: review.publishContext.localHeadSha,
        },
        pullRequestNumber: prNumber,
      });

      if (result.notice) setNotice(result.notice);
      if (result.merged || result.alreadyMerged) {
        setMergeStatus("merged");
      }

      try {
        await recordReviewDecision(review.bookmark.id, {
          action: "approve",
          merged: result.merged,
          mergeSha: result.sha ?? undefined,
          prNumber: result.pullRequestNumber,
          reason: result.selfApproval
            ? "self-approval; merge-only"
            : result.alreadyMerged
              ? "already-merged"
              : undefined,
        });
      } catch (recordError) {
        setNotice(
          `Merged on GitHub but failed to record decision: ${
            recordError instanceof Error ? recordError.message : "unknown"
          }`,
        );
      }

      onMerged();
    } catch (err) {
      const message = userFacingActionError(err, "Approve & merge failed");
      if (/Approval recorded but merge failed/i.test(message)) {
        try {
          await recordReviewDecision(review.bookmark.id, {
            action: "approve",
            merged: false,
            prNumber: prNumber ?? undefined,
            reason: "approve-only; merge failed",
          });
        } catch {
          // ignore
        }
      }
      if (/already merged/i.test(message)) {
        setMergeStatus("merged");
        setNotice("Pull request was already merged.");
        onMerged();
        return;
      }
      if (/is closed and cannot be merged/i.test(message)) {
        setMergeStatus("closed");
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const ciPassing = ci?.checkStatus === "success";
  const ciLabel =
    ci?.checkStatus === "success"
      ? "CI passing"
      : ci?.checkStatus === "failure"
        ? "CI failing"
        : ci?.checkStatus === "pending"
          ? "CI running"
          : "CI status unknown";

  return (
    <div className="approve-bar">
      <div className="approve-inner">
        <div className="approve-status">
          {merged ? (
            <span className="ci">
              <span className="tick">✓</span>Merged
            </span>
          ) : closed ? (
            <span className="ci">Closed</span>
          ) : (
            <button
              type="button"
              className="ci"
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                color: ciPassing
                  ? "var(--gx-ok)"
                  : ci?.checkStatus === "failure"
                    ? "var(--gx-risk)"
                    : "var(--gx-muted)",
              }}
              onClick={() => void refreshCi()}
              onFocus={() => void ensureCi()}
            >
              <span className="tick">
                {ciPassing ? "✓" : ci?.checkStatus === "failure" ? "✗" : "·"}
              </span>
              {ciLabel}
              {ci?.message ? (
                <span className="ci-detail num">{ci.message}</span>
              ) : null}
            </button>
          )}
          {canMerge ? (
            <span className="approve-note">
              Approves PR{prNumber ? ` #${prNumber}` : ""} as you on GitHub, then
              merges. Your decision is recorded to the review ledger.
            </span>
          ) : null}
          {error ? (
            <span className="approve-note" style={{ color: "var(--gx-risk)" }}>
              {error}
            </span>
          ) : null}
          {notice ? (
            <span className="approve-note" style={{ color: "var(--gx-warn)" }}>
              {notice}
            </span>
          ) : null}
        </div>
        <div className="btn-group">
          {prUrl ? (
            <a
              className="btn-secondary"
              href={prUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in GitHub
            </a>
          ) : null}
          {canMerge ? (
            <button
              className="btn-approve"
              type="button"
              disabled={busy}
              onClick={() => void handleApprove()}
              onFocus={() => void ensureCi()}
            >
              {busy ? "Working…" : "Approve & merge"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
