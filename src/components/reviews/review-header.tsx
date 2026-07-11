import Link from "next/link";
import type { ReviewResponse } from "@/lib/reviews-client";

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function statusDot(status: string): string {
  if (status === "merged") return "var(--gx-ok)";
  if (status === "closed") return "var(--gx-muted)";
  return "var(--gx-ok)";
}

function riskDot(level: string | null): string {
  const l = (level ?? "").toLowerCase();
  if (l === "low") return "var(--gx-ok)";
  if (l === "medium" || l === "med") return "var(--gx-warn)";
  if (l === "high" || l === "critical") return "var(--gx-risk)";
  return "var(--gx-faint)";
}

export function ReviewSiteHeader({ review }: { review: ReviewResponse }) {
  const [org, repo] = review.bookmark.repoFullName.split("/");
  const id = review.bookmark.id;
  const shortId =
    id.startsWith("bm_") || id.length <= 12 ? id : `bm_${id.slice(0, 6)}`;

  return (
    <header className="site-header">
      <Link className="gx-mark" href="/">
        gx
      </Link>
      <div className="crumb">
        <span>{org}</span>
        <span className="sep">/</span>
        <span>{repo}</span>
        <span className="sep">/</span>
        <strong>{shortId}</strong>
      </div>
    </header>
  );
}

export function ReviewHeader({ review }: { review: ReviewResponse }) {
  const { bookmark, publishContext } = review;
  const headSha = bookmark.headCommitId ?? bookmark.remoteHeadSha;
  const githubBlob = headSha
    ? `https://github.com/${bookmark.repoFullName}/commit/${headSha}`
    : null;

  return (
    <div className="review-head">
      <h1>{bookmark.title || bookmark.branchName}</h1>
      <div className="meta-line num">
        <span className="m">
          <span className="dot" style={{ background: statusDot(bookmark.mergeStatus) }} />
          {bookmark.mergeStatus}
        </span>
        {bookmark.riskLevel ? (
          <span className="m">
            <span className="dot" style={{ background: riskDot(bookmark.riskLevel) }} />
            {bookmark.riskLevel} risk
          </span>
        ) : null}
        <span className="m">
          {bookmark.fileCount} file{bookmark.fileCount === 1 ? "" : "s"}
        </span>
        <span className="m">
          {bookmark.revisionCount} revision
          {bookmark.revisionCount === 1 ? "" : "s"}
        </span>
        <span className="m">
          {publishContext.headBranch} → {publishContext.baseBranch}
        </span>
        {headSha && githubBlob ? (
          <span className="m">
            <a href={githubBlob} target="_blank" rel="noreferrer">
              {headSha.slice(0, 7)}
            </a>
          </span>
        ) : null}
        <span className="m">
          {relativeTime(bookmark.publishedAtMs)}
          {bookmark.pushedBy ? ` by ${bookmark.pushedBy}` : ""}
        </span>
        {bookmark.githubPrUrl ? (
          <span className="m">
            <a href={bookmark.githubPrUrl} target="_blank" rel="noreferrer">
              {bookmark.githubPrNumber
                ? `PR #${bookmark.githubPrNumber} ↗`
                : "PR ↗"}
            </a>
          </span>
        ) : null}
        {review.plan.model === "mock" ? (
          <span className="m">mock plan</span>
        ) : null}
      </div>
    </div>
  );
}
