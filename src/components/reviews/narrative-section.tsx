import type { ReviewPlan } from "@/lib/reviews-client";

const SOURCE_STYLE: Record<string, { label: string; color: string }> = {
  "agent-sessions": { label: "agent sessions", color: "var(--gx-agent-fill)" },
  codebase: { label: "codebase", color: "var(--gx-src-codebase)" },
  "previous-prs": { label: "previous PRs", color: "var(--gx-src-prs)" },
  docs: { label: "independent docs", color: "var(--gx-src-docs)" },
  "pr-payload": { label: "PR payload", color: "var(--gx-faint)" },
};

export function NarrativeSection({ plan }: { plan: ReviewPlan }) {
  const { narrative } = plan;
  const sources = narrative.attributionSources.filter((s) => s.pct > 0);
  const mode =
    "attributionMode" in narrative &&
    (narrative as { attributionMode?: string }).attributionMode === "measured"
      ? "measured"
      : "estimated";
  const tooltip =
    mode === "measured"
      ? "Measured from cited evidence."
      : "Estimated evidence provenance for this narrative — not measured.";
  const aria = sources
    .map((s) => `${SOURCE_STYLE[s.source]?.label ?? s.source} ${s.pct} percent`)
    .join(", ");

  return (
    <>
      <section className="intro">
        <details className="intro-acc">
          <summary>
            <span className="twist">▶</span>
            <span className="acc-title">Summary</span>
            <span className="teaser">
              {narrative.summaryTeaser || narrative.summary}
              {(narrative.summaryTeaser || narrative.summary).endsWith("…")
                ? ""
                : " …"}
            </span>
          </summary>
          <div className="intro-body">
            <p>{narrative.summary}</p>
            {narrative.selfReportQuote ? (
              <p className="quote">
                <span className="who">agent self-report</span> — “
                {narrative.selfReportQuote}”
              </p>
            ) : null}
          </div>
        </details>

        <details className="intro-acc">
          <summary>
            <span className="twist">▶</span>
            <span className="acc-title">Why?</span>
            <span className="teaser">
              {narrative.whyTeaser || narrative.why}
              {(narrative.whyTeaser || narrative.why).endsWith("…") ? "" : " …"}
            </span>
          </summary>
          <div className="intro-body">
            <p>{narrative.why}</p>
          </div>
        </details>

        {sources.length > 0 ? (
          <div className="attr-row num" title={tooltip}>
            <span className="label">Attribution</span>
            <div
              className="attr-bar"
              role="img"
              aria-label={`Attribution sources: ${aria}`}
            >
              {sources.map((src) => (
                <span
                  key={src.source}
                  style={{
                    width: `${Math.max(src.pct, 0)}%`,
                    background:
                      SOURCE_STYLE[src.source]?.color ?? "var(--gx-faint)",
                  }}
                />
              ))}
            </div>
            {sources.map((src) => (
              <span className="key" key={src.source}>
                <span
                  className="swatch"
                  style={{
                    background:
                      SOURCE_STYLE[src.source]?.color ?? "var(--gx-faint)",
                  }}
                />
                {SOURCE_STYLE[src.source]?.label ?? src.source}{" "}
                <span className="pct">{src.pct}%</span>
              </span>
            ))}
          </div>
        ) : null}
      </section>
      <hr className="rule" />
    </>
  );
}
