"use client";

import { useState } from "react";
import type { UsageBreakdown } from "@/lib/reviews-client";

function formatTok(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatMTok(total: number): string {
  const m = total / 1_000_000;
  if (m >= 10) return `${Math.round(m)} MTok`;
  if (m >= 0.01) return `${m.toFixed(1)} MTok`;
  return `${formatTok(total)} tok`;
}

function formatUsd(cost: number | null): string {
  if (cost === null) return "—";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function UsageAccordion({
  usage,
  defaultOpen = false,
}: {
  usage: UsageBreakdown | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!usage) return null;
  const { totals, byHarness, unknownModels } = usage;

  return (
    <details
      className="usage"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="twist">▶</span>
        <h2>Agent usage</h2>
        <span className="usage-summary-stats num">
          <span className="tok">{formatMTok(totals.totalTokens)}</span>
          <span className="cost-total">est. {formatUsd(totals.costUsd)}</span>
          {totals.unpricedModels > 0 ? (
            <span className="unpriced">+{totals.unpricedModels} unpriced</span>
          ) : null}
        </span>
      </summary>
      <div className="usage-rows num">
        {byHarness.map((row) => {
          const cached = Math.min(Math.max(row.cachedPct, 0), 100);
          const fresh = 100 - cached;
          return (
            <div className="usage-row" key={`${row.harness}-${row.model}`}>
              <div className="top">
                <span className="harness">{row.harness}</span>
                <span className="model">{row.model}</span>
                <span className={`cost${row.costUsd === null ? " na" : ""}`}>
                  {formatUsd(row.costUsd)}
                </span>
              </div>
              <div className="stats">
                <span>
                  {row.sessions} session{row.sessions === 1 ? "" : "s"}
                </span>
                <span>in {formatTok(row.inputTokens)}</span>
                <span>out {formatTok(row.outputTokens)}</span>
                {row.cacheReadTokens > 0 ? (
                  <span>{row.cachedPct}% cached</span>
                ) : null}
              </div>
              <div
                className="cache-bar"
                role="img"
                aria-label={
                  row.cacheReadTokens > 0
                    ? `${row.cachedPct} percent of input tokens served from cache`
                    : "cache breakdown unavailable"
                }
              >
                <span className="cached" style={{ width: `${cached}%` }} />
                <span
                  className="fresh"
                  style={{
                    width: `${fresh}%`,
                    ...(row.cacheReadTokens === 0 ? { opacity: 0.35 } : {}),
                  }}
                />
              </div>
            </div>
          );
        })}
        <div className="usage-foot">
          Estimated from captured token counts and public list prices.
          {unknownModels.length > 0 ? (
            <>
              {" "}
              <span className="warn-note">
                {unknownModels.join(", ")}{" "}
                {unknownModels.length === 1 ? "has" : "have"} no published
                pricing.
              </span>
            </>
          ) : null}
        </div>
      </div>
    </details>
  );
}
