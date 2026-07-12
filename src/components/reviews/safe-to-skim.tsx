"use client";

import { useState } from "react";
import type { ReviewPlan, ReviewResponse } from "@/lib/reviews-client";

export function SafeToSkim({
  items,
  review,
  defaultOpen = false,
}: {
  items: ReviewPlan["safeToSkim"];
  review: ReviewResponse;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  const headSha =
    review.bookmark.headCommitId || review.bookmark.remoteHeadSha || "HEAD";
  const repo = review.bookmark.repoFullName;

  return (
    <details
      className="skim"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="twist">▶</span>
        <h2>Safe to skim</h2>
        <span className="count">
          {items.length} file{items.length === 1 ? "" : "s"} · mechanical or
          derived changes
        </span>
      </summary>
      <div className="skim-list">
        {items.map((item) => (
          <div className="skim-row" key={item.file}>
            <a
              className="path"
              href={`https://github.com/${repo}/blob/${headSha}/${item.file}`}
              target="_blank"
              rel="noreferrer"
            >
              {item.file} ↗
            </a>
            <span className="why">{item.reason}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
