import type { ReviewResponse } from "@/lib/reviews-client";

type Props = {
  review: ReviewResponse;
};

export function GithubPrBar({ review }: Props) {
  const prNumber =
    review.publishContext.pullRequestNumber ?? review.bookmark.githubPrNumber;
  const prUrl =
    review.publishContext.pullRequestUrl ?? review.bookmark.githubPrUrl;
  const mergeStatus = review.bookmark.mergeStatus;

  if (!prUrl) return null;

  return (
    <div className="github-bar">
      <div className="github-bar-inner">
        <div className="github-bar-status">
          {mergeStatus === "merged" ? (
            <span className="ci">
              <span className="tick">✓</span>Merged
            </span>
          ) : mergeStatus === "closed" ? (
            <span className="ci closed">Closed</span>
          ) : (
            <span className="github-bar-hint">
              Approve and merge{prNumber ? ` PR #${prNumber}` : ""} on GitHub.
            </span>
          )}
        </div>
        <a className="btn-github" href={prUrl} target="_blank" rel="noreferrer">
          Go to GitHub
        </a>
      </div>
    </div>
  );
}
