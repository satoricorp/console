import Link from "next/link";
import { PatchDiff } from "@pierre/diffs/react";
import type { ReviewPlan, ReviewResponse } from "@/lib/reviews-client";

const CAT_CLASS: Record<string, string> = {
  behavior: "blast",
  "failure-path": "blast",
  boundary: "arch",
  architecture: "arch",
  pattern: "parad",
  "blast-radius": "blast",
  other: "",
};

const CAT_LABEL: Record<string, string> = {
  behavior: "behavior",
  "failure-path": "failure path",
  boundary: "boundary",
  architecture: "architecture",
  pattern: "pattern",
  "blast-radius": "blast radius",
  other: "other",
};

function countDiffStats(patch: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) adds += 1;
    if (line.startsWith("-") && !line.startsWith("---")) dels += 1;
  }
  return { adds, dels };
}

export function findNotablePatch(
  patches: ReviewResponse["notablePatches"],
  change: ReviewPlan["notableChanges"][number],
) {
  return (
    patches.find((patch) => patch.rank === change.rank) ??
    patches.find(
      (patch) =>
        patch.file === change.anchor.file &&
        (!patch.revisionChangeId ||
          !change.anchor.revisionChangeId ||
          patch.revisionChangeId === change.anchor.revisionChangeId),
    )
  );
}

export function CriticalReviewSection({
  plan,
  review,
}: {
  plan: ReviewPlan;
  review: ReviewResponse;
}) {
  const total = plan.notableChanges.length;
  const headSha =
    review.bookmark.headCommitId || review.bookmark.remoteHeadSha || "HEAD";
  const repo = review.bookmark.repoFullName;

  return (
    <>
      <div className="section-head">
        <h2>Critical Review</h2>
        <span className="count">
          {total} of {review.bookmark.fileCount || total}
        </span>
      </div>

      <div className="cards">
        {total === 0 ? (
          <p className="text-[13px] text-zinc-500">
            No critical runtime hunks identified.
          </p>
        ) : null}
        {plan.notableChanges.map((change) => {
          const patch = findNotablePatch(review.notablePatches, change);
          const stats = patch ? countDiffStats(patch.patch) : { adds: 0, dels: 0 };
          const lineStart = change.anchor.lineStart;
          const lineEnd = change.anchor.lineEnd;
          const blobUrl =
            lineStart != null && lineEnd != null
              ? `https://github.com/${repo}/blob/${headSha}/${change.anchor.file}#L${lineStart}-L${lineEnd}`
              : `https://github.com/${repo}/blob/${headSha}/${change.anchor.file}`;
          const cat = CAT_CLASS[change.category] ?? "";
          const isAgent = change.attribution?.authorship === "agent";

          return (
            <article key={`${change.rank}-${change.anchor.file}`} className="card">
              <div className="card-top">
                <span className="rank">{change.rank}</span>
                <div className="card-title-wrap">
                  <h3 className="card-title">{change.title}</h3>
                  <div className="card-badges">
                    <span className={`cat ${cat}`.trim()}>
                      <span className="dot" />
                      {CAT_LABEL[change.category] ?? change.category}
                    </span>
                    {change.anchor.revisionChangeId ? (
                      <Link
                        className="rev-link"
                        href={`/r/${change.anchor.revisionChangeId}`}
                      >
                        r/{change.anchor.revisionChangeId.slice(0, 6)}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="card-why">
                <p>{change.whyItMatters}</p>
              </div>

              <div className="card-anchor">
                <a className="anchor-link" href={blobUrl} target="_blank" rel="noreferrer">
                  <span className="path">{change.anchor.file}</span>
                  {lineStart != null && lineEnd != null ? (
                    <span className="lines num">
                      L{lineStart}–{lineEnd} ↗
                    </span>
                  ) : (
                    <span className="lines num">↗</span>
                  )}
                </a>
                {change.attribution ? (
                  <span className={`attr-chip${isAgent ? "" : " human"}`}>
                    {isAgent
                      ? `agent · ${change.attribution.tool ?? "?"} · ${change.attribution.model ?? "?"}`
                      : `human · ${change.attribution.tool ?? change.attribution.model ?? "author"}`}
                  </span>
                ) : null}
              </div>

              {patch?.patch ? (
                <div
                  className="diff"
                  style={
                    change.anchorConfidence === "exact"
                      ? { boxShadow: "inset 3px 0 0 var(--gx-accent)" }
                      : undefined
                  }
                >
                  <PatchDiff patch={patch.patch} disableWorkerPool />
                </div>
              ) : null}

              <div className="diff-foot">
                <span>
                  +{stats.adds} −{stats.dels}
                </span>
                <a href={blobUrl} target="_blank" rel="noreferrer">
                  full file diff
                </a>
                {change.attribution?.tool ? (
                  <span>session transcript ↗</span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
