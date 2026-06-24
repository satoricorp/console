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

  if (ctx.publishedRevisions?.length) {
    lines.push("GX published revisions (newest first):");
    for (const revision of ctx.publishedRevisions.slice(0, 12)) {
      const branch = revision.branchName ? ` branch=${revision.branchName}` : "";
      const base = revision.baseBranchName ? ` base=${revision.baseBranchName}` : "";
      const description = revision.description ? ` description=${revision.description}` : "";
      lines.push(`- revision${branch}${base}${description}`);
      if (revision.files.length > 0) {
        lines.push(`  files: ${revision.files.slice(0, 20).join(", ")}`);
      }
      if (revision.patch) {
        lines.push(revision.patch.slice(0, 1_500));
      }
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

  if (ctx.publishedSessions?.length) {
    lines.push("GX published sessions:");
    for (const session of ctx.publishedSessions.slice(0, 12)) {
      const command = session.command ? ` command=${session.command}` : "";
      lines.push(
        `- ${session.sessionId}${command} requests=${session.requestCount} responses=${session.responseCount}`,
      );
    }
  }

  lines.push("", "Write the PR Summary now.");
  return lines.join("\n");
}
