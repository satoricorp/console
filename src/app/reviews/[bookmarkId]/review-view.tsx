"use client";

import { PatchDiff } from "@pierre/diffs/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActivityPanel } from "@/components/reviews/activity-panel";
import { CriticalReviewSection } from "@/components/reviews/critical-review-card";
import { GithubPrBar } from "@/components/reviews/github-pr-bar";
import { NarrativeSection } from "@/components/reviews/narrative-section";
import { PlanFallback, PlanPending } from "@/components/reviews/plan-pending";
import { ReviewHeader, ReviewSiteHeader } from "@/components/reviews/review-header";
import { SafeToSkim } from "@/components/reviews/safe-to-skim";
import { UsageAccordion } from "@/components/reviews/usage-accordion";
import {
  fetchReview,
  regenerateReviewPlan,
  type ReviewResponse,
} from "@/lib/reviews-client";
import "@/components/reviews/reviews.css";

export function ReviewView({
  bookmarkId,
  initial,
  demoMode = false,
}: {
  bookmarkId: string;
  initial: ReviewResponse | null;
  demoMode?: boolean;
}) {
  const [review, setReview] = useState<ReviewResponse | null>(initial);
  const [error, setError] = useState<string | null>(
    initial ? null : "Review not found",
  );
  const [loading, setLoading] = useState(!initial && !demoMode);

  const reload = useCallback(async () => {
    try {
      const next = await fetchReview(bookmarkId);
      setReview(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review");
    } finally {
      setLoading(false);
    }
  }, [bookmarkId]);

  useEffect(() => {
    if (initial || demoMode) return;
    let cancelled = false;
    void fetchReview(bookmarkId)
      .then((next) => {
        if (cancelled) return;
        setReview(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load review");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookmarkId, demoMode, initial]);

  const pending =
    review?.plan.status === "pending" || review?.plan.status === "missing";

  useEffect(() => {
    if (!pending || demoMode) return;
    const id = window.setInterval(() => {
      void reload();
    }, 4000);
    return () => window.clearInterval(id);
  }, [demoMode, pending, reload]);

  if (loading && !review) {
    return (
      <div className="gx-review">
        <main className="wrap">
          <PlanPending />
        </main>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="gx-review">
        <main className="wrap" style={{ textAlign: "center", paddingTop: 80 }}>
          <h1 style={{ fontSize: 19, fontWeight: 650 }}>Review not found</h1>
          <p style={{ color: "var(--gx-muted)", marginTop: 8 }}>{error}</p>
          <p style={{ marginTop: 16 }}>
            <Link
              href={demoMode ? "/reviews?demo=1" : "/reviews"}
              style={{ color: "var(--gx-muted)" }}
            >
              ← Reviews
            </Link>
          </p>
        </main>
      </div>
    );
  }

  const plan = review.plan.plan;
  const showFallback =
    review.plan.status === "failed" ||
    (review.plan.status === "ready" && !plan);

  return (
    <div className="gx-review">
      <ReviewSiteHeader review={review} demoMode={demoMode} />
      <main className="wrap">
        <ReviewHeader review={review} />

        {pending ? <PlanPending /> : null}

        {showFallback ? (
          <PlanFallback
            summary={review.summary?.content ?? null}
            error={review.plan.error}
            onRetry={() => {
              void regenerateReviewPlan(bookmarkId, true).then(() => reload());
            }}
          />
        ) : null}

        {plan && !pending ? (
          <>
            <NarrativeSection plan={plan} />
            <CriticalReviewSection plan={plan} review={review} />
            <ActivityPanel activity={review.activity} />
            <SafeToSkim items={plan.safeToSkim} review={review} />
            <UsageAccordion usage={review.usage} />
          </>
        ) : null}

        {showFallback ? (
          <>
            <ActivityPanel activity={review.activity} />
            <UsageAccordion usage={review.usage} />
            {review.changes.map((change) =>
              change.patch ? (
                <article
                  className="card"
                  key={change.changeId}
                  style={{ marginBottom: 18 }}
                >
                  <div className="card-top">
                    <div className="card-title-wrap">
                      <h3 className="card-title">{change.title}</h3>
                    </div>
                  </div>
                  <div className="diff">
                    <PatchDiff patch={change.patch} disableWorkerPool />
                  </div>
                </article>
              ) : null,
            )}
          </>
        ) : null}
      </main>
      {demoMode ? null : <GithubPrBar review={review} />}
    </div>
  );
}
