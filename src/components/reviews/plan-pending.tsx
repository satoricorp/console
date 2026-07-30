export function PlanPending() {
  return (
    <div className="only-pending">
      <div className="pending-hero">
        <div className="spinner" aria-hidden="true" />
        <h2>Analyzing this push</h2>
        <p>
          tx is ranking what needs human review — pattern changes, blast radius,
          and architectural decisions. Usually under a minute.
        </p>
      </div>
      <div className="skeleton" aria-hidden="true">
        <div className="shimmer" style={{ width: "34%" }} />
        <div className="shimmer" style={{ width: "88%" }} />
        <div className="shimmer" style={{ width: "72%" }} />
      </div>
      <div className="skeleton" aria-hidden="true">
        <div className="shimmer" style={{ width: "28%" }} />
        <div className="shimmer" style={{ width: "81%" }} />
        <div className="shimmer" style={{ width: "64%" }} />
      </div>
    </div>
  );
}

export function PlanFallback({
  summary,
  error,
  onRetry,
}: {
  summary: string | null;
  error: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="only-fallback">
      <div className="notice">
        <span className="mark">!</span>
        <p>
          tx couldn’t build a review plan for this push.
          <small>
            Showing the standard summary and full diffs instead.
            {error ? ` (${error})` : ""}{" "}
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Retry analysis
              </button>
            ) : null}
          </small>
        </p>
      </div>
      {summary ? (
        <div className="summary-block">
          <span className="label">PR summary</span>
          <pre>{summary}</pre>
        </div>
      ) : null}
    </div>
  );
}
