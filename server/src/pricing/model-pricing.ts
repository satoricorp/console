export type ModelTokenPricing = {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
  /** USD per 1M cache-read tokens (defaults to input if omitted) */
  cacheRead?: number;
  /** USD per 1M cache-write tokens (defaults to input if omitted) */
  cacheWrite?: number;
};

export type ModelPricingRule = {
  family: string;
  match: RegExp;
  pricing: ModelTokenPricing;
};

/** Public list prices (USD / 1M tokens). Approximate; update as providers change. */
export const MODEL_PRICING_RULES: ModelPricingRule[] = [
  {
    family: "claude-opus",
    match: /claude[-_.]?opus|opus[-_.]?4/i,
    pricing: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  },
  {
    family: "claude-sonnet",
    match: /claude[-_.]?sonnet|sonnet[-_.]?4|sonnet[-_.]?3\.5/i,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    family: "claude-haiku",
    match: /claude[-_.]?haiku|haiku/i,
    pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  },
  {
    family: "gpt-5",
    match: /gpt[-_.]?5(\.|$|[-_])/i,
    pricing: { input: 1.25, output: 10, cacheRead: 0.125 },
  },
  {
    family: "gpt-4.1",
    match: /gpt[-_.]?4\.1/i,
    pricing: { input: 2, output: 8, cacheRead: 0.5 },
  },
  {
    family: "gpt-4o",
    match: /gpt[-_.]?4o/i,
    pricing: { input: 2.5, output: 10, cacheRead: 1.25 },
  },
  {
    family: "o-series",
    match: /\bo[1-4]([-_.]|$)/i,
    pricing: { input: 15, output: 60, cacheRead: 7.5 },
  },
  {
    family: "gemini-2.5-pro",
    match: /gemini[-_.]?2\.5[-_.]?pro/i,
    pricing: { input: 1.25, output: 10, cacheRead: 0.315 },
  },
  {
    family: "gemini-2.5-flash",
    match: /gemini[-_.]?2\.5[-_.]?flash/i,
    pricing: { input: 0.15, output: 0.6, cacheRead: 0.0375 },
  },
  {
    family: "gemini-pro",
    match: /gemini[-_.]?(1\.5[-_.]?)?pro/i,
    pricing: { input: 1.25, output: 5, cacheRead: 0.315 },
  },
  {
    family: "gemini-flash",
    match: /gemini[-_.]?(1\.5[-_.]?)?flash/i,
    pricing: { input: 0.075, output: 0.3, cacheRead: 0.01875 },
  },
];

/**
 * Normalize provider model ids for fuzzy matching:
 * lowercase; strip `us.anthropic.`, `bedrock:`, date/version suffixes.
 */
export function normalizeModelId(modelId: string): string {
  let id = modelId.trim().toLowerCase();
  id = id.replace(/^bedrock:/, "");
  id = id.replace(/^us\.anthropic\./, "");
  id = id.replace(/^anthropic\./, "");
  // Strip trailing date stamps like -20241022 or :20241022
  id = id.replace(/[-_:]?\d{8}$/, "");
  // Strip trailing version tags like -v1:0 or @20241022
  id = id.replace(/@[\w.-]+$/, "");
  id = id.replace(/:[\d.]+$/, "");
  return id;
}

export function pricingForModel(modelId: string): ModelTokenPricing | null {
  if (!modelId.trim()) return null;
  const normalized = normalizeModelId(modelId);
  for (const rule of MODEL_PRICING_RULES) {
    if (rule.match.test(normalized) || rule.match.test(modelId)) {
      return rule.pricing;
    }
  }
  return null;
}

export function estimateCostUsd(args: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number | null {
  const pricing = pricingForModel(args.modelId);
  if (!pricing) return null;
  const cacheRead = args.cacheReadTokens ?? 0;
  const cacheWrite = args.cacheWriteTokens ?? 0;
  const cacheReadRate = pricing.cacheRead ?? pricing.input;
  const cacheWriteRate = pricing.cacheWrite ?? pricing.input;
  return (
    (args.inputTokens * pricing.input +
      args.outputTokens * pricing.output +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate) /
    1_000_000
  );
}
