import type { GitBlameContext } from "../github/git-blame";
import { githubPullFileLineUrl } from "../github/line-links";
import type { GitHubPrFileContext, RecentComment } from "../llm/prompts/gx-chat";
import type { ExtractContext } from "../summary/generate";

export type GxCitationKind =
  | "published_revision"
  | "hunk_link"
  | "session_event"
  | "index_snippet"
  | "github_pr_file"
  | "git_blame";

export type GxCitation = {
  id: string;
  kind: GxCitationKind;
  label: string;
  text: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  url?: string;
};

export type GxCitationContext = {
  citations: GxCitation[];
  promptText: string;
};

export function buildTxCitationContext(input: {
  latestSummary: string | null;
  context: ExtractContext | null;
  githubPrFiles: GitHubPrFileContext[];
  gitBlameContext: GitBlameContext | null;
  recentComments: RecentComment[];
}): GxCitationContext {
  void input.latestSummary;
  void input.recentComments;

  const citations: GxCitation[] = [];
  const push = (citation: Omit<GxCitation, "id">) => {
    citations.push({ ...citation, id: `S${citations.length + 1}` });
  };

  for (const file of input.githubPrFiles.slice(0, 20)) {
    const status = file.status ?? "changed";
    const additions = typeof file.additions === "number" ? file.additions : 0;
    const deletions = typeof file.deletions === "number" ? file.deletions : 0;
    const range =
      typeof file.lineStart === "number" && typeof file.lineEnd === "number"
        ? `:${file.lineStart}-${file.lineEnd}`
        : "";
    push({
      kind: "github_pr_file",
      file: file.filename,
      lineStart: file.lineStart,
      lineEnd: file.lineEnd,
      url: file.url,
      label: `github_pr_file: ${file.filename}${range} ${status} +${additions} -${deletions}`,
      text: file.patch ?? "",
    });
  }

  if (input.context) {
    const githubPrUrl = contextGithubPrUrl(input.context);

    for (const revision of (input.context.publishedRevisions ?? []).slice(0, 12)) {
      const files = revision.files.filter(Boolean);
      const fileLabel = files.length ? files.join(", ") : "unknown files";
      const branch = revision.branchName ?? "unknown branch";
      push({
        kind: "published_revision",
        file: files[0],
        url: revision.githubPrUrl ?? undefined,
        label: `published_revision: ${branch} touched ${fileLabel}`,
        text: [
          revision.description ? `description: ${revision.description}` : "",
          revision.baseBranchName ? `base: ${revision.baseBranchName}` : "",
          revision.patch ?? "",
        ].filter(Boolean).join("\n"),
      });
    }

    for (const hunk of input.context.hunkLinks.slice(0, 20)) {
      push({
        kind: "hunk_link",
        file: hunk.file,
        lineStart: hunk.lineStart,
        lineEnd: hunk.lineEnd,
        url: githubPullFileLineUrl(githubPrUrl, hunk.file, hunk.lineStart) ?? undefined,
        label: `hunk_link: ${hunk.file}:${hunk.lineStart}-${hunk.lineEnd} ${hunk.authorship} hunk`,
        text: [
          `session: ${hunk.sessionId}`,
          `confidence: ${hunk.confidence.toFixed(2)}`,
          hunk.tool ? `tool: ${hunk.tool}` : "",
          hunk.model ? `model: ${hunk.model}` : "",
        ].filter(Boolean).join("\n"),
      });
    }

    for (const event of input.context.sessionEvents.slice(0, 20)) {
      push({
        kind: "session_event",
        file: event.filePath ?? undefined,
        label: `session_event: ${event.eventType} in ${event.filePath ?? "unknown file"}`,
        text: [
          `session: ${event.sessionId}`,
          `raw_line: ${event.rawLine}`,
          `tool: ${event.tool}`,
          event.model ? `model: ${event.model}` : "",
        ].filter(Boolean).join("\n"),
      });
    }

    for (const snippet of (input.context.indexSnippets ?? []).slice(0, 12)) {
      const score = typeof snippet.score === "number" ? ` score=${snippet.score.toFixed(3)}` : "";
      const source = snippet.sourceKind ?? "indexed";
      push({
        kind: "index_snippet",
        label: `index_snippet: ${source} ${snippet.id}${score}`,
        text: snippet.text,
      });
    }
  }

  for (const row of input.gitBlameContext?.rows.slice(0, 12) ?? []) {
    const file = row.previousFilePath ?? row.filePath;
    push({
      kind: "git_blame",
      file,
      url: row.codeUrl ?? row.commitUrl ?? undefined,
      label: `git_blame: ${file}:${row.blameLineStart}-${row.blameLineEnd} ${row.commitSha.slice(0, 12)}`,
      text: [
        row.messageHeadline ?? "",
        row.authorLogin ? `author: ${row.authorLogin}` : row.authorName ? `author: ${row.authorName}` : "",
        row.associatedPrUrl ? `associated_pr: ${row.associatedPrUrl}` : "",
      ].filter(Boolean).join("\n"),
    });
  }

  return {
    citations,
    promptText: formatCitationPrompt(citations),
  };
}

export function parseTxChatModelReply(text: string): { answer: string; citations: string[] } | null {
  try {
    const decoded = JSON.parse(text) as unknown;
    if (!isRecord(decoded) || typeof decoded.answer !== "string") {
      return null;
    }
    return {
      answer: decoded.answer,
      citations: Array.isArray(decoded.citations)
        ? decoded.citations.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export function inlineCitationIds(text: string): string[] {
  return [...text.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
}

export function validCitationIds(ids: string[], citations: GxCitation[]): string[] {
  const available = new Set(citations.map((citation) => citation.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!available.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function formatTxCitedReply(answer: string, citationIds: string[], citations: GxCitation[]): string {
  const valid = validCitationIds(citationIds, citations);
  const validSet = new Set(valid);
  let cleanAnswer = answer.replace(/\s*\[(S\d+)\]/g, (full, id: string) => validSet.has(id) ? full : "");
  cleanAnswer = cleanAnswer.replace(/\s+/g, " ").trim();
  const prefixed = /^gx:/i.test(cleanAnswer) ? cleanAnswer : `gx: ${cleanAnswer}`;
  if (valid.length === 0) {
    return prefixed;
  }
  const sourceText = valid
    .map((id) => {
      const citation = citations.find((item) => item.id === id);
      return citation ? `${idDescription(citation)}` : "";
    })
    .filter(Boolean)
    .join(" ");
  return `${prefixed}\n\nSources: ${sourceText}`;
}

function formatCitationPrompt(citations: GxCitation[]): string {
  if (citations.length === 0) {
    return "Available sources:\n(none)";
  }
  const lines = ["Available sources:"];
  for (const citation of citations) {
    lines.push(`[${citation.id}] ${citation.label}`);
    if (citation.url) {
      lines.push(`url: ${citation.url}`);
    }
    if (citation.text.trim()) {
      lines.push(citation.text.trim().slice(0, 2_000));
    }
  }
  return lines.join("\n");
}

function idDescription(citation: GxCitation): string {
  const target = citation.file ? formatFileTarget(citation) : "evidence";
  switch (citation.kind) {
    case "published_revision":
      return `[${citation.id}] published revision ${target}.`;
    case "hunk_link":
      return `[${citation.id}] hunk ${target}.`;
    case "session_event":
      return `[${citation.id}] session event ${target}.`;
    case "index_snippet":
      return `[${citation.id}] indexed context.`;
    case "github_pr_file":
      return `[${citation.id}] GitHub PR file ${target}.`;
    case "git_blame":
      return `[${citation.id}] git blame ${target}.`;
  }
}

function formatFileTarget(citation: GxCitation): string {
  const range =
    typeof citation.lineStart === "number" && typeof citation.lineEnd === "number"
      ? `:${citation.lineStart}-${citation.lineEnd}`
      : typeof citation.lineStart === "number"
        ? `:${citation.lineStart}`
        : "";
  const label = `${citation.file}${range}`;
  return citation.url ? `[${label}](${citation.url})` : `\`${label}\``;
}

function contextGithubPrUrl(context: ExtractContext): string | null {
  return (
    context.publishedRevisions?.find((revision) => revision.githubPrUrl)
      ?.githubPrUrl ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
