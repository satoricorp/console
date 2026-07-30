import { estimateCostUsd } from "../pricing/model-pricing";
import type {
  UsageBreakdown,
  UsageHarnessRow,
  UsageSessionRow,
  UsageTokenCounts,
} from "./types";

type ProvenanceEntry = {
  session_id?: string;
  agent_tool?: string;
  provider?: string;
  model_id?: string;
  source?: unknown;
};

type ArtifactSession = {
  id?: string;
  session_id?: string;
  sessionId?: string;
  uuid?: string;
  command?: string;
  process_name?: string;
  tool?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  requests?: ArtifactRequest[];
};

type ArtifactRequest = {
  model?: string;
  model_id?: string;
  responses?: ArtifactResponse[];
};

type ArtifactResponse = {
  model?: string;
  tokens_in?: number | null;
  tokens_out?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  response_body?: unknown;
};

function emptyCounts(): UsageTokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function sessionIdOf(session: ArtifactSession): string | null {
  const raw =
    session.id ?? session.session_id ?? session.sessionId ?? session.uuid;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function parseUsageFromBody(body: unknown): UsageTokenCounts | null {
  let parsed: unknown = body;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return null;
    // Prefer a top-level JSON object; fall back to locating a "usage" blob.
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/"usage"\s*:\s*(\{[^}]*\})/);
      if (!match?.[1]) return null;
      try {
        parsed = { usage: JSON.parse(match[1]) };
      } catch {
        return null;
      }
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const usage =
    obj.usage && typeof obj.usage === "object"
      ? (obj.usage as Record<string, unknown>)
      : obj;

  const input =
    asNumber(usage.input_tokens) ||
    asNumber(usage.prompt_tokens) ||
    asNumber(usage.inputTokens) ||
    asNumber((usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
  const output =
    asNumber(usage.output_tokens) ||
    asNumber(usage.completion_tokens) ||
    asNumber(usage.outputTokens);
  const cacheRead =
    asNumber(usage.cache_read_input_tokens) ||
    asNumber(usage.cache_read_tokens) ||
    asNumber(usage.cached_tokens) ||
    asNumber((usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
  const cacheWrite =
    asNumber(usage.cache_creation_input_tokens) ||
    asNumber(usage.cache_write_tokens);

  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return null;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

function responseTokens(resp: ArtifactResponse): UsageTokenCounts {
  const fromCols: UsageTokenCounts = {
    inputTokens: asNumber(resp.input_tokens) || asNumber(resp.tokens_in),
    outputTokens: asNumber(resp.output_tokens) || asNumber(resp.tokens_out),
    cacheReadTokens: asNumber(resp.cache_read_tokens),
    cacheWriteTokens: asNumber(resp.cache_write_tokens),
  };
  if (
    fromCols.inputTokens > 0 ||
    fromCols.outputTokens > 0 ||
    fromCols.cacheReadTokens > 0 ||
    fromCols.cacheWriteTokens > 0
  ) {
    return fromCols;
  }
  return parseUsageFromBody(resp.response_body) ?? emptyCounts();
}

function harnessFromCommand(command: string | undefined, processName: string | undefined): string | null {
  const hay = `${command ?? ""} ${processName ?? ""}`.toLowerCase();
  if (!hay.trim()) return null;
  if (/\bcodex\b/.test(hay)) return "codex";
  if (/\bclaude\b/.test(hay) || /\banthropic\b/.test(hay)) return "claude";
  if (/\bcursor\b/.test(hay)) return "cursor";
  if (/\bopencode\b/.test(hay)) return "opencode";
  if (/\bgemini\b/.test(hay)) return "gemini";
  if (/\baider\b/.test(hay)) return "aider";
  return null;
}

function buildSessionHarnessMap(
  provenance: ProvenanceEntry[],
  sessions: ArtifactSession[],
): Map<string, { harness: string; model?: string }> {
  const map = new Map<string, { harness: string; model?: string }>();
  for (const entry of provenance) {
    const sessionId = entry.session_id?.trim();
    const tool = entry.agent_tool?.trim();
    if (!sessionId || !tool) continue;
    if (tool === "tx_commit") continue;
    map.set(sessionId, {
      harness: tool,
      model: typeof entry.model_id === "string" ? entry.model_id : undefined,
    });
  }
  for (const session of sessions) {
    const sessionId = sessionIdOf(session);
    if (!sessionId || map.has(sessionId)) continue;
    const heuristic =
      harnessFromCommand(session.command, session.process_name) ||
      (typeof session.tool === "string" && session.tool !== "tx_commit"
        ? session.tool
        : null);
    if (heuristic) {
      map.set(sessionId, { harness: heuristic, model: session.model });
    }
  }
  return map;
}

function addCounts(a: UsageTokenCounts, b: UsageTokenCounts): UsageTokenCounts {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

function totalOf(c: UsageTokenCounts): number {
  return c.inputTokens + c.outputTokens + c.cacheReadTokens + c.cacheWriteTokens;
}

function cachedPct(c: UsageTokenCounts): number {
  const denom = c.inputTokens + c.cacheReadTokens;
  if (denom <= 0) return 0;
  return Math.round((c.cacheReadTokens / denom) * 1000) / 10;
}

/**
 * Aggregate token/cost usage from a published artifact's sessions + provenance.
 * Never requires loading full response bodies unless token columns are missing.
 */
export function buildUsageBreakdown(args: {
  sessions?: unknown;
  agentProvenance?: unknown;
}): UsageBreakdown {
  const sessions = Array.isArray(args.sessions)
    ? (args.sessions as ArtifactSession[])
    : [];
  const provenance = Array.isArray(args.agentProvenance)
    ? (args.agentProvenance as ProvenanceEntry[])
    : [];

  const harnessMap = buildSessionHarnessMap(provenance, sessions);
  const bySession: UsageSessionRow[] = [];
  const unknownModels = new Set<string>();

  for (const session of sessions) {
    const sessionId = sessionIdOf(session);
    if (!sessionId) continue;

    const mapped = harnessMap.get(sessionId);
    const harness =
      mapped?.harness ||
      harnessFromCommand(session.command, session.process_name) ||
      "unknown";

    let counts = emptyCounts();
    let model =
      mapped?.model ||
      session.model ||
      "";

    const requests = Array.isArray(session.requests) ? session.requests : [];
    if (requests.length > 0) {
      for (const req of requests) {
        if (!model && (req.model || req.model_id)) {
          model = req.model || req.model_id || model;
        }
        for (const resp of req.responses ?? []) {
          if (!model && resp.model) model = resp.model;
          counts = addCounts(counts, responseTokens(resp));
        }
      }
    } else {
      // Session-level rollup fallback
      counts = {
        inputTokens: asNumber(session.input_tokens) || asNumber(session.tokens_in),
        outputTokens: asNumber(session.output_tokens) || asNumber(session.tokens_out),
        cacheReadTokens: asNumber(session.cache_read_tokens),
        cacheWriteTokens: asNumber(session.cache_write_tokens),
      };
    }

    if (totalOf(counts) === 0) continue;

    const modelId = model || "unknown";
    const costUsd = estimateCostUsd({
      modelId,
      inputTokens: counts.inputTokens,
      outputTokens: counts.outputTokens,
      cacheReadTokens: counts.cacheReadTokens,
      cacheWriteTokens: counts.cacheWriteTokens,
    });
    if (costUsd === null && modelId !== "unknown") {
      unknownModels.add(modelId);
    }

    bySession.push({
      sessionId,
      harness,
      model: modelId,
      ...counts,
      costUsd,
    });
  }

  const harnessKey = (row: UsageSessionRow) => `${row.harness}::${row.model}`;
  const harnessMapAgg = new Map<string, UsageHarnessRow>();
  for (const row of bySession) {
    const key = harnessKey(row);
    const existing = harnessMapAgg.get(key);
    if (!existing) {
      harnessMapAgg.set(key, {
        harness: row.harness,
        model: row.model,
        sessions: 1,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        cachedPct: 0,
        costUsd: row.costUsd,
      });
      continue;
    }
    existing.sessions += 1;
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.cacheReadTokens += row.cacheReadTokens;
    existing.cacheWriteTokens += row.cacheWriteTokens;
    if (existing.costUsd === null || row.costUsd === null) {
      existing.costUsd = null;
    } else {
      existing.costUsd += row.costUsd;
    }
  }

  const byHarness = [...harnessMapAgg.values()]
    .map((row) => ({
      ...row,
      cachedPct: cachedPct(row),
      costUsd:
        row.costUsd === null
          ? null
          : Math.round(row.costUsd * 1_000_000) / 1_000_000,
    }))
    .sort((a, b) => totalOf(b) - totalOf(a));

  const totals = bySession.reduce(
    (acc, row) => addCounts(acc, row),
    emptyCounts(),
  );
  const priced = bySession.reduce(
    (sum, row) => (row.costUsd === null ? sum : sum + row.costUsd),
    0,
  );
  const unpricedModels = unknownModels.size;
  const anyUnpriced = bySession.some((row) => row.costUsd === null);

  return {
    totals: {
      ...totals,
      totalTokens: totalOf(totals),
      costUsd: anyUnpriced && priced === 0 ? null : Math.round(priced * 1_000_000) / 1_000_000,
      unpricedModels,
    },
    byHarness,
    bySession,
    unknownModels: [...unknownModels].sort(),
  };
}

export { parseUsageFromBody, normalizeHarnessForTest as harnessFromCommand };

/** Exported for tests */
function normalizeHarnessForTest(
  command: string | undefined,
  processName: string | undefined,
): string | null {
  return harnessFromCommand(command, processName);
}
