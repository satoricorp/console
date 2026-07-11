"use client";

import { CriticalReviewSection } from "@/components/reviews/critical-review-card";
import { NarrativeSection } from "@/components/reviews/narrative-section";
import { ReviewHeader } from "@/components/reviews/review-header";
import { SafeToSkim } from "@/components/reviews/safe-to-skim";
import { DEMO_REVIEW } from "@/lib/demo-review";
import "@/components/reviews/reviews.css";

export function ReviewDemoPreview() {
  const plan = DEMO_REVIEW.plan.plan;
  if (!plan) return null;

  return (
    <div className="gx-review overflow-hidden border border-zinc-200 dark:border-zinc-800">
      <p className="border-b border-zinc-200 bg-zinc-50 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        Example review
      </p>
      <div className="wrap" style={{ paddingTop: 24, paddingBottom: 28 }}>
        <ReviewHeader review={DEMO_REVIEW} />
        <NarrativeSection plan={plan} />
        <CriticalReviewSection plan={plan} review={DEMO_REVIEW} />
        <SafeToSkim items={plan.safeToSkim} review={DEMO_REVIEW} />
      </div>
    </div>
  );
}
