import type { ExtractContext } from "../../summary/generate";

export const PR_SUMMARY_SYSTEM_PROMPT = `You write PR Summaries for GitHub pull request comments.

Output plain text only. Use exactly these section headings, each on its own line:
Intent
Read these
Safe to skim
Blast radius
Agent friction
Provenance

Rules:
- At most 20 lines total including blank lines
- Be concise; bullet lines count as lines
- Never use the word "brief"
- Mention binding rules only when violated
- Under Provenance, cite GX capture (hunk_links, session_events) when available`;

const maxPatchCharsPerRevision = 3000;
const maxPatchCharsTotal = 12000;

export function buildPRSummaryUserPrompt(ctx: ExtractContext): string {
  const lines: string[] = [
    `Repository root: ${ctx.repoRootPath ?? "unknown"}`,
    `Head commit: ${ctx.headCommitId ?? "unknown"}`,
    `Ref range: ${ctx.refRange ?? "unknown"}`,
  ];

  if (ctx.fileStats) {
    lines.push(`File stats: ${JSON.stringify(ctx.fileStats)}`);
  }

  if (ctx.intentCandidates.length > 0) {
    lines.push(`Intent candidates: ${JSON.stringify(ctx.intentCandidates)}`);
  }

  const revisions = ctx.publishedRevisions ?? [];
  if (revisions.length > 0) {
    lines.push("Published revisions:");
    let patchBudget = maxPatchCharsTotal;
    for (const revision of revisions.slice(0, 10)) {
      const title = revision.description?.split("\n")[0]?.trim() || "(no description)";
      const branch = revision.branchName ? ` [${revision.branchName}]` : "";
      lines.push(`- ${title}${branch}`);
      if (revision.files.length > 0) {
        lines.push(`  Files: ${revision.files.slice(0, 30).join(", ")}`);
      }
      if (revision.patch && patchBudget > 0) {
        const excerpt = revision.patch.slice(
          0,
          Math.min(maxPatchCharsPerRevision, patchBudget),
        );
        patchBudget -= excerpt.length;
        lines.push("  Patch excerpt:");
        lines.push("```diff");
        lines.push(excerpt);
        if (excerpt.length < revision.patch.length) {
          lines.push("[patch truncated]");
        }
        lines.push("```");
      }
    }
  }

  const publishedSessions = ctx.publishedSessions ?? [];
  if (publishedSessions.length > 0) {
    lines.push("Captured agent sessions linked to this change:");
    for (const session of publishedSessions.slice(0, 8)) {
      lines.push(
        `- ${session.sessionId || "session"} command=${session.command ?? "?"} requests=${session.requestCount}`,
      );
    }
  }

  if (ctx.hunkLinks.length > 0) {
    lines.push("Hunk links (file, lines, session, tier, authorship):");
    for (const link of ctx.hunkLinks.slice(0, 40)) {
      lines.push(
        `- ${link.file}:${link.lineStart}-${link.lineEnd} session=${link.sessionId} tier=${link.matchTier} auth=${link.authorship} tool=${link.tool ?? "?"}`,
      );
    }
    if (ctx.hunkLinks.length > 40) {
      lines.push(`- … ${ctx.hunkLinks.length - 40} more hunks omitted`);
    }
  }

  if (ctx.sessionEvents.length > 0) {
    lines.push("Session events (sample):");
    for (const event of ctx.sessionEvents.slice(0, 20)) {
      lines.push(
        `- ${event.sessionId} ${event.eventType} ${event.filePath ?? ""} line=${event.rawLine}`,
      );
    }
  }

  lines.push("", "Write the PR Summary now.");
  return lines.join("\n");
}
