import type { GitBlameContext } from "../github/git-blame";
import type { GitHubPrFileContext, RecentComment } from "../llm/prompts/gx-chat";
import type { ExtractContext } from "../summary/generate";

export type GxCitation = {
  id: string;
  kind:
    | "published_revision"
    | "hunk_link"
    | "session_event"
    | "index_snippet"
    | "git_blame"
    | "github_pr_file"
    | "review_rule"
    | "summary"
    | "recent_comment";
  label: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  url?: string;
  textPreview?: string;
};

export type GxCitationContext = {
  citations: GxCitation[];
  promptText: string;
};

export type GxChatModelReply = {
  answer: string;
  citations: string[];
};

export function buildGxCitationContext(input: {
  latestSummary: string | null;
  context: ExtractContext | null;
  gitBlameContext?: GitBlameContext | null;
  githubPrFiles: GitHubPrFileContext[];
  recentComments: RecentComment[];
}): GxCitationContext {
  const citations: Omit<GxCitation, "id">[] = [];

  for (const revision of (input.context?.publishedRevisions ?? []).slice(0, 12)) {
    const branch = revision.branchName ?? "published revision";
    const files = revision.files.slice(0, 5).join(", ");
    const description = revision.description ? `: ${revision.description}` : "";
    citations.push({
      kind: "published_revision",
      label: files ? `${branch} touched ${files}${description}` : `${branch}${description}`,
      file: revision.files.length === 1 ? revision.files[0] : undefined,
      url: revision.githubPrUrl ?? undefined,
      textPreview: [revision.description, revision.files.join(", "), revision.patch]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1_800),
    });
  }

  for (const hunk of (input.context?.hunkLinks ?? []).slice(0, 20)) {
    citations.push({
      kind: "hunk_link",
      label: `${hunk.file}:${hunk.lineStart}-${hunk.lineEnd} ${hunk.authorship} hunk`,
      file: hunk.file,
      lineStart: hunk.lineStart,
      lineEnd: hunk.lineEnd,
      textPreview: [
        `authorship=${hunk.authorship}`,
        `confidence=${hunk.confidence.toFixed(2)}`,
        `session=${hunk.sessionId}`,
        hunk.tool ? `tool=${hunk.tool}` : "",
        hunk.model ? `model=${hunk.model}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  for (const event of (input.context?.sessionEvents ?? []).slice(0, 20)) {
    citations.push({
      kind: "session_event",
      label: `${event.eventType} in ${event.filePath ?? event.sessionId}`,
      file: event.filePath ?? undefined,
      lineStart: event.rawLine,
      textPreview: [
        `session=${event.sessionId}`,
        `event=${event.eventType}`,
        `tool=${event.tool}`,
        event.model ? `model=${event.model}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  for (const snippet of (input.context?.indexSnippets ?? []).slice(0, 12)) {
    const source = snippet.sourceKind ? `${snippet.sourceKind} ` : "";
    const score =
      typeof snippet.score === "number" ? ` score=${snippet.score.toFixed(3)}` : "";
    citations.push({
      kind: "index_snippet",
      label: `${source}${snippet.id}${score}`.trim(),
      textPreview: snippet.text.slice(0, 1_200),
    });
  }

  for (const file of input.githubPrFiles.slice(0, 20)) {
    const status = file.status ? ` ${file.status}` : "";
    const additions = typeof file.additions === "number" ? ` +${file.additions}` : "";
    const deletions = typeof file.deletions === "number" ? ` -${file.deletions}` : "";
    citations.push({
      kind: "github_pr_file",
      label: `${file.filename}${status}${additions}${deletions}`,
      file: file.filename,
      textPreview: file.patch?.slice(0, 1_200),
    });
  }

  const numbered = citations.map((citation, index) => ({
    ...citation,
    id: `S${index + 1}`,
  }));

  return {
    citations: numbered,
    promptText: renderCitationPrompt(numbered),
  };
}

export function parseGxChatModelReply(text: string): GxChatModelReply | null {
  const jsonText = extractJsonObject(text.trim());
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.answer !== "string") {
    return null;
  }

  const citations = Array.isArray(parsed.citations)
    ? parsed.citations.filter((id): id is string => typeof id === "string")
    : [];

  return {
    answer: parsed.answer.trim(),
    citations,
  };
}

export function validCitationIds(ids: string[], citations: GxCitation[]): string[] {
  const available = new Set(citations.map((citation) => citation.id));
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const id of ids) {
    const normalized = id.trim();
    if (!available.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    valid.push(normalized);
  }
  return valid;
}

export function formatGxCitedReply(
  answer: string,
  citationIds: string[],
  citations: GxCitation[],
): string {
  const normalizedAnswer = normalizeGxAnswer(stripInvalidInlineCitationIds(answer, citationIds));
  const selected = citationIds
    .map((id) => citations.find((citation) => citation.id === id))
    .filter((citation): citation is GxCitation => Boolean(citation));

  if (selected.length === 0) {
    return normalizedAnswer;
  }

  return `${normalizedAnswer}\n\nSources: ${selected.map(formatCitationSource).join("; ")}.`;
}

export function inlineCitationIds(text: string): string[] {
  return [...text.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
}

function renderCitationPrompt(citations: GxCitation[]): string {
  const lines: string[] = ["Available sources:"];
  if (citations.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }

  for (const citation of citations) {
    lines.push(`[${citation.id}] ${citation.kind}: ${citation.label}`);
    if (citation.file) {
      const range =
        typeof citation.lineStart === "number" && typeof citation.lineEnd === "number"
          ? `:${citation.lineStart}-${citation.lineEnd}`
          : typeof citation.lineStart === "number"
            ? `:${citation.lineStart}`
            : "";
      lines.push(`  file: ${citation.file}${range}`);
    }
    if (citation.url) {
      lines.push(`  url: ${citation.url}`);
    }
    if (citation.textPreview?.trim()) {
      lines.push("  evidence:");
      for (const line of citation.textPreview.trim().split("\n").slice(0, 30)) {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join("\n");
}

function formatCitationSource(citation: GxCitation): string {
  const target = citation.file ? formatFileTarget(citation) : citation.label;
  switch (citation.kind) {
    case "published_revision":
      return `[${citation.id}] published revision ${target}`;
    case "hunk_link":
      return `[${citation.id}] hunk ${target}`;
    case "session_event":
      return `[${citation.id}] session evidence ${target}`;
    case "index_snippet":
      return `[${citation.id}] indexed context ${target}`;
    case "github_pr_file":
      return `[${citation.id}] PR diff ${target}`;
    case "git_blame":
      return `[${citation.id}] git blame ${target}`;
    case "review_rule":
      return `[${citation.id}] review rule ${target}`;
    case "summary":
      return `[${citation.id}] summary ${target}`;
    case "recent_comment":
      return `[${citation.id}] recent comment ${target}`;
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

function normalizeGxAnswer(answer: string): string {
  const lines = answer
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 8);
  const text = lines.join("\n").trim();
  if (!text) {
    return "GX: I couldn't answer from the available review context.";
  }
  return /^gx:/i.test(text) ? text : `GX: ${text}`;
}

function stripInvalidInlineCitationIds(answer: string, citationIds: string[]): string {
  const valid = new Set(citationIds);
  return answer
    .replace(/\s*\[(S\d+)\]/g, (match, id: string) => (valid.has(id) ? match : ""))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
