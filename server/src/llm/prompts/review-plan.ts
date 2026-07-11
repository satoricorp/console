import type { ReviewPlanContext } from "../../review-plan/context";

export const REVIEW_PLAN_SYSTEM_PROMPT = `You are a principal engineer writing a focused human review plan for a pull request.

Return JSON only (no markdown fences) matching this schema:
{
  "schemaVersion": 1,
  "narrative": {
    "summary": string,          // purpose + original intent, <=600 chars
    "summaryTeaser": string,    // exactly one sentence; shown when Summary is collapsed
    "why": string,              // rationale for the approach, <=600 chars
    "whyTeaser": string,        // exactly one sentence; shown when Why? is collapsed
    "attributionSources": [     // model estimate of evidence provenance (not measured) — sum ~100
      {"source": "agent-sessions"|"codebase"|"previous-prs"|"docs", "pct": number}
    ],
    "selfReportQuote": string   // short quote of agent self-report / first prompt
  },
  "notableChanges": [           // 3–7 ranked items humans must review
    {
      "rank": number,
      "category": "architecture"|"pattern"|"blast-radius"|"other",
      "title": string,
      "whyItMatters": string,   // 2–3 sentences
      "anchor": {
        "file": string,         // must be a changed file
        "lineStart": number,    // new-file line numbers inside shown hunks
        "lineEnd": number,
        "revisionChangeId": string
      },
      "anchorConfidence": "exact"|"file"|"unverified",
      "attribution": {"authorship": "agent"|"human", "tool"?: string, "model"?: string}
    }
  ],
  "safeToSkim": [{"file": string, "reason": string}],
  "revisions": [{"changeId": string, "branchName"?: string, "title"?: string}]
}

Rules:
- Prefer architecture, pattern, and blast-radius categories for notable changes.
- Every changed file that is not notable must appear in safeToSkim with a one-line reason.
- Anchors must reference changed files; line numbers must fall inside the provided hunk new-line ranges when possible (anchorConfidence="exact").
- Summary must restate the original intent and quote the self-report / first user prompt when available.
- summaryTeaser and whyTeaser must each be exactly one sentence (a condensation of the full text).
- attributionSources percentages are your estimate of where the narrative's evidence came from based on the context blocks — informative, not measured.
- Be specific and concrete. No filler. No markdown.`;

export function buildReviewPlanUserPrompt(ctx: ReviewPlanContext): string {
  const lines: string[] = [
    `Repository: ${ctx.repoFullName}`,
    `Branch: ${ctx.branchName} → ${ctx.baseBranch}`,
    `Head: ${ctx.headCommitId}`,
    `Title: ${ctx.title ?? "(none)"}`,
  ];

  if (ctx.risk) {
    lines.push(
      `Risk: ${ctx.risk.level ?? "?"} score=${ctx.risk.score ?? "?"} signals=${JSON.stringify(ctx.risk.signals ?? [])}`,
    );
  }

  lines.push("", "## Intent");
  if (ctx.intent.selfReport?.taskSummary) {
    lines.push(`Self-report: ${ctx.intent.selfReport.taskSummary}`);
    if (ctx.intent.selfReport.commandsRun?.length) {
      lines.push(`Commands: ${ctx.intent.selfReport.commandsRun.slice(0, 8).join(" | ")}`);
    }
    if (ctx.intent.selfReport.testsRun?.length) {
      lines.push(`Tests: ${ctx.intent.selfReport.testsRun.slice(0, 8).join(" | ")}`);
    }
  }
  for (const msg of ctx.intent.firstUserMessages) {
    lines.push(`First user message: ${msg}`);
  }
  for (const intent of ctx.intent.demuxIntents) {
    lines.push(`Demux intent: ${intent}`);
  }
  for (const desc of ctx.intent.descriptions) {
    lines.push(`Revision description: ${desc.slice(0, 500)}`);
  }

  lines.push("", "## Revisions");
  for (const rev of ctx.revisions) {
    lines.push(
      `- ${rev.changeId} branch=${rev.branchName ?? "?"} files=${rev.files.length}: ${rev.files.slice(0, 20).join(", ")}`,
    );
    if (rev.changedSymbols?.length) {
      for (const sym of rev.changedSymbols.slice(0, 15)) {
        lines.push(
          `  symbol ${sym.file}:${sym.startLine ?? "?"}-${sym.endLine ?? "?"} ${sym.kind ?? ""} ${sym.symbol ?? ""}`,
        );
      }
    }
  }

  if (ctx.hunkLinks.length > 0) {
    lines.push("", "## Hunk attribution (secondary)");
    for (const link of ctx.hunkLinks.slice(0, 40)) {
      lines.push(
        `- ${link.file}:${link.lineStart}-${link.lineEnd} ${link.authorship} tool=${link.tool ?? "?"} model=${link.model ?? "?"}`,
      );
    }
  }

  lines.push("", "## Patches (capped)");
  for (const fp of ctx.cappedPatches) {
    lines.push(`### ${fp.file}`);
    lines.push(fp.text);
    lines.push("");
  }

  lines.push(
    "",
    "Write the review plan JSON now. Choose 3–7 notable changes that truly need human review.",
  );
  return lines.join("\n");
}
