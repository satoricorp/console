export type DecisionAction = "approve" | "request_changes" | "comment";

export type RuleStrength = "binding" | "preference";

export type InferredRule = {
  ruleText: string;
  scopeExpr: string | null;
  strength: RuleStrength;
};

export type ClassifyInput = {
  body: string;
  reviewer: string;
  reviewState?: "approved" | "changes_requested" | "commented" | null;
  repoScope?: string | null;
};

export type ClassifyResult = {
  decision: {
    action: DecisionAction;
    extractedReason: string | null;
  };
  rules: InferredRule[];
};

const BINDING_PATTERNS: Array<{ pattern: RegExp; scopeGroup?: number; textGroup?: number }> = [
  {
    pattern: /\bnever\s+(.+?)\s+in\s+([^\s.,;]+)/i,
    textGroup: 1,
    scopeGroup: 2,
  },
  {
    pattern: /\b(?:don'?t|do not|must not|should not|cannot|can'?t)\s+(.+)/i,
    textGroup: 1,
  },
  {
    pattern: /\balways\s+(.+)/i,
    textGroup: 1,
  },
];

const PREFERENCE_PATTERNS: Array<{ pattern: RegExp; scopeGroup?: number; textGroup?: number }> = [
  {
    pattern: /\bprefer(?:red|ably)?\s+(?:to\s+)?(.+)/i,
    textGroup: 1,
  },
  {
    pattern: /\b(?:ideally|better to)\s+(.+)/i,
    textGroup: 1,
  },
];

export function classifyReviewComment(input: ClassifyInput): ClassifyResult {
  const body = input.body.trim();
  const decision = inferDecision(input.reviewState, body);
  const rules = inferRules(body, input.repoScope ?? null);

  return {
    decision,
    rules,
  };
}

function inferDecision(
  reviewState: ClassifyInput["reviewState"],
  body: string,
): ClassifyResult["decision"] {
  if (reviewState === "approved") {
    return { action: "approve", extractedReason: body || null };
  }
  if (reviewState === "changes_requested") {
    return { action: "request_changes", extractedReason: body || null };
  }
  if (reviewState === "commented") {
    return { action: "comment", extractedReason: body || null };
  }

  const lower = body.toLowerCase();
  if (/\b(?:lgtm|looks good|approved?)\b/.test(lower) && !/\b(?:not|don't|do not)\b/.test(lower)) {
    return { action: "approve", extractedReason: body || null };
  }
  if (/\b(?:request(?:ing)? changes|needs changes|must fix|blocking)\b/.test(lower)) {
    return { action: "request_changes", extractedReason: body || null };
  }

  return { action: "comment", extractedReason: body || null };
}

function inferRules(body: string, repoScope: string | null): InferredRule[] {
  if (!body.trim()) {
    return [];
  }

  const rules: InferredRule[] = [];
  const seen = new Set<string>();

  for (const { pattern, textGroup = 1, scopeGroup } of BINDING_PATTERNS) {
    const match = body.match(pattern);
    if (!match) continue;
    const ruleText = cleanRuleText(match[textGroup] ?? body);
    const scopeExpr = scopeGroup ? match[scopeGroup]?.trim() ?? repoScope : repoScope;
    addRule(rules, seen, ruleText, scopeExpr, "binding");
  }

  for (const { pattern, textGroup = 1, scopeGroup } of PREFERENCE_PATTERNS) {
    const match = body.match(pattern);
    if (!match) continue;
    const ruleText = cleanRuleText(match[textGroup] ?? body);
    const scopeExpr = scopeGroup ? match[scopeGroup]?.trim() ?? repoScope : repoScope;
    addRule(rules, seen, ruleText, scopeExpr, "preference");
  }

  return rules;
}

function addRule(
  rules: InferredRule[],
  seen: Set<string>,
  ruleText: string,
  scopeExpr: string | null,
  strength: RuleStrength,
): void {
  const key = `${strength}:${ruleText.toLowerCase()}`;
  if (!ruleText || seen.has(key)) {
    return;
  }
  seen.add(key);
  rules.push({ ruleText, scopeExpr, strength });
}

function cleanRuleText(text: string): string {
  return text.replace(/[.!?]+$/, "").trim();
}
