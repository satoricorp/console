import {
  filePatchIndex,
  type ReviewPlanContext,
} from "./context";
import { newLineRanges, rangesIntersect } from "./patch";
import type {
  AnchorConfidence,
  AttributionSource,
  NotableCategory,
  NotableChange,
  ReviewPlan,
  SafeToSkimItem,
} from "./types";

const CATEGORIES: NotableCategory[] = [
  "architecture",
  "pattern",
  "blast-radius",
  "other",
];

const ATTRIBUTION_SOURCES: AttributionSource["source"][] = [
  "agent-sessions",
  "codebase",
  "previous-prs",
  "docs",
  "pr-payload",
];

const BROKER_BUCKETS = [
  "agent-sessions",
  "codebase",
  "previous-prs",
  "docs",
] as const;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstSentence(text: string, max = 160): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = (match?.[1] ?? trimmed.split(/\n/)[0] ?? trimmed).trim();
  if (sentence.length <= max) return sentence.endsWith("…") ? sentence : sentence;
  return `${sentence.slice(0, max - 1).trimEnd()}…`;
}

function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function parseCategory(value: unknown): NotableCategory {
  const s = asString(value)?.toLowerCase();
  if (s === "architecture" || s === "pattern" || s === "blast-radius" || s === "other") {
    return s;
  }
  if (s === "blast_radius" || s === "blastradius") return "blast-radius";
  return "other";
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return JSON.parse(fence[1].trim());
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("No JSON object found in model response");
}

export type ValidatePlanResult = {
  ok: boolean;
  plan: ReviewPlan | null;
  anchorValidationRate: number;
  categoryCoverage: number;
  error?: string;
};

/**
 * Parse + validate a model ReviewPlan. Drops unknown-file anchors;
 * downgrades line ranges that don't intersect patch hunks to "file".
 */
export function parseAndValidateReviewPlan(
  rawText: string,
  ctx: ReviewPlanContext,
): ValidatePlanResult {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(rawText);
  } catch (error) {
    return {
      ok: false,
      plan: null,
      anchorValidationRate: 0,
      categoryCoverage: 0,
      error: error instanceof Error ? error.message : "invalid_json",
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      plan: null,
      anchorValidationRate: 0,
      categoryCoverage: 0,
      error: "not_object",
    };
  }

  const root = parsed as Record<string, unknown>;
  const narrativeRaw =
    root.narrative && typeof root.narrative === "object"
      ? (root.narrative as Record<string, unknown>)
      : {};

  const changedFiles = new Set(ctx.allFiles);
  const patches = filePatchIndex(ctx);

  const notableRaw = Array.isArray(root.notableChanges)
    ? root.notableChanges
    : Array.isArray(root.notable_changes)
      ? root.notable_changes
      : [];

  let exactOrFile = 0;
  let totalAnchors = 0;
  const notableChanges: NotableChange[] = [];

  for (const item of notableRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const anchorRaw =
      row.anchor && typeof row.anchor === "object"
        ? (row.anchor as Record<string, unknown>)
        : {};
    const file = asString(anchorRaw.file) ?? asString(row.file);
    if (!file) continue;
    totalAnchors += 1;
    if (!changedFiles.has(file) && !patches.has(file)) {
      continue;
    }

    let lineStart =
      typeof anchorRaw.lineStart === "number"
        ? anchorRaw.lineStart
        : typeof anchorRaw.line_start === "number"
          ? anchorRaw.line_start
          : undefined;
    let lineEnd =
      typeof anchorRaw.lineEnd === "number"
        ? anchorRaw.lineEnd
        : typeof anchorRaw.line_end === "number"
          ? anchorRaw.line_end
          : undefined;

    let confidence: AnchorConfidence = "unverified";
    const declared = asString(row.anchorConfidence) ?? asString(row.anchor_confidence);
    const patch = patches.get(file);
    if (patch && lineStart != null && lineEnd != null) {
      const ranges = newLineRanges(patch);
      const hits = ranges.some((r) =>
        rangesIntersect(r, { start: lineStart!, end: lineEnd! }),
      );
      if (hits) {
        confidence = "exact";
        exactOrFile += 1;
      } else {
        confidence = "file";
        lineStart = undefined;
        lineEnd = undefined;
        exactOrFile += 1;
      }
    } else if (patch || changedFiles.has(file)) {
      confidence = declared === "exact" ? "file" : "file";
      lineStart = undefined;
      lineEnd = undefined;
      exactOrFile += 1;
    } else if (declared === "exact" || declared === "file" || declared === "unverified") {
      confidence = declared;
    }

    const attributionRaw =
      row.attribution && typeof row.attribution === "object"
        ? (row.attribution as Record<string, unknown>)
        : null;

    notableChanges.push({
      rank: typeof row.rank === "number" ? row.rank : notableChanges.length + 1,
      category: parseCategory(row.category),
      title: clampText(asString(row.title) ?? file, 120),
      whyItMatters: clampText(
        asString(row.whyItMatters) ?? asString(row.why_it_matters) ?? "",
        600,
      ),
      anchor: {
        file,
        lineStart,
        lineEnd,
        revisionChangeId:
          asString(anchorRaw.revisionChangeId) ??
          asString(anchorRaw.revision_change_id) ??
          undefined,
      },
      anchorConfidence: confidence,
      attribution: attributionRaw
        ? {
            authorship: asString(attributionRaw.authorship) ?? "unknown",
            tool: asString(attributionRaw.tool) ?? undefined,
            model: asString(attributionRaw.model) ?? undefined,
          }
        : undefined,
    });
  }

  // Rank + cap 3–7
  notableChanges.sort((a, b) => a.rank - b.rank);
  const capped = notableChanges.slice(0, 7).map((c, i) => ({ ...c, rank: i + 1 }));

  if (capped.length < 1) {
    return {
      ok: false,
      plan: null,
      anchorValidationRate: totalAnchors > 0 ? exactOrFile / totalAnchors : 0,
      categoryCoverage: 0,
      error: "no_surviving_changes",
    };
  }

  const safeRaw = Array.isArray(root.safeToSkim)
    ? root.safeToSkim
    : Array.isArray(root.safe_to_skim)
      ? root.safe_to_skim
      : [];
  const safeToSkim: SafeToSkimItem[] = [];
  const notableFiles = new Set(capped.map((c) => c.anchor.file));
  for (const item of safeRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const file = asString(row.file);
    const reason = asString(row.reason);
    if (!file || !reason) continue;
    if (notableFiles.has(file)) continue;
    safeToSkim.push({ file, reason: clampText(reason, 200) });
  }
  // Ensure every non-notable changed file has a skim reason
  for (const file of ctx.allFiles) {
    if (notableFiles.has(file)) continue;
    if (safeToSkim.some((s) => s.file === file)) continue;
    safeToSkim.push({ file, reason: "Supporting change; low review priority." });
  }

  const attrRaw = Array.isArray(narrativeRaw.attributionSources)
    ? narrativeRaw.attributionSources
    : Array.isArray(narrativeRaw.attribution_sources)
      ? narrativeRaw.attribution_sources
      : [];
  let attributionSources: AttributionSource[] = [];
  for (const item of attrRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const source = asString(row.source) as AttributionSource["source"] | null;
    const pct = typeof row.pct === "number" ? row.pct : Number(row.pct);
    if (!source || !ATTRIBUTION_SOURCES.includes(source)) continue;
    if (!Number.isFinite(pct)) continue;
    attributionSources.push({ source, pct: Math.max(0, Math.min(100, pct)) });
  }
  if (attributionSources.length === 0) {
    attributionSources = fallbackAttributionFromManifest(ctx);
  } else {
    attributionSources = clampAttributionToManifest(attributionSources, ctx);
  }
  const attrSum = attributionSources.reduce((s, a) => s + a.pct, 0) || 1;
  attributionSources = attributionSources.map((a) => ({
    ...a,
    pct: Math.round((a.pct / attrSum) * 1000) / 10,
  }));

  const revisions = ctx.revisions.map((r) => ({
    changeId: r.changeId,
    branchName: r.branchName ?? undefined,
    title: r.description?.split("\n")[0]?.slice(0, 120) || undefined,
  }));

  const categoriesUsed = new Set(capped.map((c) => c.category));
  const categoryCoverage =
    CATEGORIES.filter((c) => c !== "other").filter((c) => categoriesUsed.has(c))
      .length / 3;

  const summary = clampText(
    asString(narrativeRaw.summary) ?? ctx.intent.selfReport?.taskSummary ?? "Review these changes.",
    600,
  );
  const why = clampText(asString(narrativeRaw.why) ?? "", 600);
  const summaryTeaser = clampText(
    asString(narrativeRaw.summaryTeaser) ??
      asString(narrativeRaw.summary_teaser) ??
      firstSentence(summary),
    200,
  );
  const whyTeaser = clampText(
    asString(narrativeRaw.whyTeaser) ??
      asString(narrativeRaw.why_teaser) ??
      firstSentence(why || summary),
    200,
  );

  const plan: ReviewPlan = {
    schemaVersion: 1,
    narrative: {
      summary,
      summaryTeaser,
      why,
      whyTeaser,
      attributionSources,
      // Only quote verified self-report / first user prompt — never trust a
      // free-form model quote (it often echoes the revision description).
      selfReportQuote:
        ctx.intent.selfReport?.taskSummary ??
        ctx.intent.firstUserMessages[0] ??
        undefined,
    },
    notableChanges: capped,
    safeToSkim,
    revisions,
  };

  return {
    ok: true,
    plan,
    anchorValidationRate: totalAnchors > 0 ? exactOrFile / totalAnchors : 1,
    categoryCoverage,
    error: undefined,
  };
}

export function scoreReviewPlanCandidate(result: ValidatePlanResult): number {
  if (!result.ok || !result.plan) return 0;
  let score = 40;
  score += result.anchorValidationRate * 35;
  score += result.categoryCoverage * 15;
  const n = result.plan.notableChanges.length;
  if (n >= 3 && n <= 7) score += 10;
  else if (n >= 1) score += 4;
  if (result.plan.narrative.summary.length > 40) score += 5;
  if (result.plan.narrative.why.length > 20) score += 5;
  return score;
}

function providedChars(
  ctx: ReviewPlanContext,
  source: AttributionSource["source"],
): number {
  if (source === "pr-payload") {
    return ctx.prPayloadPresent ? 1 : 0;
  }
  const entry = ctx.contextManifest?.[source];
  return entry?.provided ? entry.chars || entry.provided : 0;
}

function clampAttributionToManifest(
  sources: AttributionSource[],
  ctx: ReviewPlanContext,
): AttributionSource[] {
  const kept = sources
    .map((s) => {
      if (s.source === "pr-payload") {
        return ctx.prPayloadPresent ? s : { ...s, pct: 0 };
      }
      const provided = ctx.contextManifest?.[s.source]?.provided ?? 0;
      // When broker off / no manifest, keep model estimate for broker buckets
      if (!ctx.contextManifest) return s;
      return provided > 0 ? s : { ...s, pct: 0 };
    })
    .filter((s) => s.pct > 0);
  return kept.length > 0 ? kept : fallbackAttributionFromManifest(ctx);
}

function fallbackAttributionFromManifest(ctx: ReviewPlanContext): AttributionSource[] {
  const weights: AttributionSource[] = [];
  for (const bucket of BROKER_BUCKETS) {
    const chars = providedChars(ctx, bucket);
    if (chars > 0) {
      weights.push({ source: bucket, pct: chars });
    }
  }
  if (ctx.prPayloadPresent) {
    // Nominal weight so empty-index plans still attribute to payload
    const payloadWeight = Math.max(
      100,
      weights.reduce((s, w) => s + w.pct, 0) * 0.25,
    );
    weights.push({ source: "pr-payload", pct: payloadWeight });
  }
  if (weights.length === 0) {
    return [{ source: "pr-payload", pct: 100 }];
  }
  return weights;
}
