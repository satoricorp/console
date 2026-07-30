import type postgres from "postgres";
import { getInstallationAccessToken } from "../github/app";
import { loadGitBlameContext, parsePatchHunks, type GitBlameContext } from "../github/git-blame";
import { githubPullFileLineUrl } from "../github/line-links";
import { createReviewProviders } from "../llm/provider";
import {
  buildTxChatUserPrompt,
  TX_CHAT_SYSTEM_PROMPT,
  type GitHubPrFileContext,
  type RecentComment,
} from "../llm/prompts/tx-chat";
import {
  loadExtractContext,
  resolveSummaryTarget,
  type ExtractContext,
} from "../summary/generate";
import {
  buildTxCitationContext,
  formatTxCitedReply,
  inlineCitationIds,
  parseTxChatModelReply,
  validCitationIds,
  type TxCitationContext,
} from "./citations";

export type TxMentionInput = {
  orgId: string;
  bookmarkId: string;
  commentId: string;
  author: string;
  body: string;
  file?: string | null;
  line?: number | null;
  github?: {
    installationId: number;
    repoFullName: string;
    pullNumber: number;
  };
};

export type TxMentionResult = {
  reply: string | null;
  vetoedRuleText: string | null;
  retiredRuleIds: string[];
};

type LatestSummary = {
  id: string;
  content: string;
};

type ChatRun = {
  text: string | null;
  score: number;
  error: string | null;
};

const VETO_PATTERNS: RegExp[] = [
  /@tx\s+(?:please\s+)?(?:skip|ignore|veto|override|retire)\s+(?:rule\s+)?(.+)/i,
  /@tx\s+(?:don'?t|do not)\s+enforce\s+(.+)/i,
];

export function containsTxMention(body: string): boolean {
  return /@tx\b/i.test(body);
}

export function parseTxMention(body: string): string | null {
  const match = body.match(/@tx\b/i);
  return match ? body.trim() : null;
}

export async function handleTxMention(
  db: postgres.Sql,
  input: TxMentionInput,
): Promise<TxMentionResult> {
  const vetoTarget = extractVetoTarget(input.body);
  const retiredRuleIds: string[] = [];

  if (vetoTarget) {
    const allowed = await authorCanVetoRules(input);
    if (!allowed) {
      console.info("tx-mention veto denied: author lacks write access", {
        orgId: input.orgId,
        bookmarkId: input.bookmarkId,
        author: input.author,
      });
      return {
        reply: `TX: only collaborators with write access can retire rules.`,
        vetoedRuleText: null,
        retiredRuleIds: [],
      };
    }
    const rules = await db<{ id: string; rule_text: string }[]>`
      SELECT id, rule_text
      FROM rules
      WHERE org_id = ${input.orgId}
        AND status IN ('inferred', 'enforced')
        AND rule_text ILIKE ${"%" + escapeLikePattern(vetoTarget) + "%"}
      ORDER BY created_at_ms DESC
      LIMIT 5
    `;

    for (const rule of rules) {
      await db`
        UPDATE rules
        SET status = 'retired'
        WHERE id = ${rule.id}
      `;
      retiredRuleIds.push(rule.id);
    }

    await db`
      INSERT INTO summary_events (
        org_id, summary_id, kind, actor, created_at_ms
      )
      SELECT
        ${input.orgId},
        s.id,
        'override',
        ${input.author},
        ${Date.now()}
      FROM summaries s
      WHERE s.org_id = ${input.orgId}
        AND s.bookmark_id = ${input.bookmarkId}
      ORDER BY s.posted_at_ms DESC
      LIMIT 1
    `;

    const reply =
      retiredRuleIds.length > 0
        ? `TX: retired ${retiredRuleIds.length} rule(s) matching "${vetoTarget}".`
        : `TX: noted override for "${vetoTarget}" (no matching active rules).`;

    console.info("tx-mention veto", {
      orgId: input.orgId,
      bookmarkId: input.bookmarkId,
      commentId: input.commentId,
      vetoTarget,
      retiredRuleIds,
    });

    return {
      reply,
      vetoedRuleText: vetoTarget,
      retiredRuleIds,
    };
  }

  const question = stripTxMention(input.body);
  const latestSummary = await loadLatestSummary(db, input.orgId, input.bookmarkId);
  const context = await loadMentionContext(db, input.orgId, input.bookmarkId);
  const recentComments = await loadRecentComments(db, input.orgId, input.bookmarkId, input.commentId);
  const githubPrFiles =
    input.github && shouldLoadGitHubPrFiles(context) ? await loadGitHubPrFiles(input.github) : [];
  const gitBlameContext =
    input.github && context
      ? await loadGitBlameContext(db, {
          orgId: input.orgId,
          repoFullName: input.github.repoFullName,
          pullNumber: input.github.pullNumber,
          installationId: input.github.installationId,
          eventId: context.eventId,
          fileHints: pickGitBlameFileHints(question, context, recentComments, input.file ?? null),
        })
      : null;
  const citationContext = buildTxCitationContext({
    latestSummary: latestSummary?.content ?? null,
    context,
    githubPrFiles,
    gitBlameContext,
    recentComments,
  });
  const reply = await generateTxChatReply({
    author: input.author,
    question,
    latestSummary: latestSummary?.content ?? null,
    context,
    githubPrFiles,
    gitBlameContext,
    recentComments,
    citationContext,
  });

  if (latestSummary) {
    await db`
      INSERT INTO summary_events (
        org_id, summary_id, kind, actor, created_at_ms
      ) VALUES (
        ${input.orgId},
        ${latestSummary.id},
        'mention',
        ${input.author},
        ${Date.now()}
      )
    `;
  }

  console.info("tx-mention chat", {
    orgId: input.orgId,
    bookmarkId: input.bookmarkId,
    commentId: input.commentId,
    author: input.author,
    replied: Boolean(reply),
    githubPrFiles: githubPrFiles.length,
    gitBlameRows: gitBlameContext?.rows.length ?? 0,
    citationCount: citationContext.citations.length,
  });

  return {
    reply,
    vetoedRuleText: null,
    retiredRuleIds,
  };
}

async function loadLatestSummary(
  db: postgres.Sql,
  orgId: string,
  bookmarkId: string,
): Promise<LatestSummary | null> {
  const [summary] = await db<LatestSummary[]>`
    SELECT id, content
    FROM summaries
    WHERE org_id = ${orgId}
      AND bookmark_id = ${bookmarkId}
    ORDER BY posted_at_ms DESC
    LIMIT 1
  `;
  return summary ?? null;
}

async function loadMentionContext(
  db: postgres.Sql,
  orgId: string,
  bookmarkId: string,
): Promise<ExtractContext | null> {
  try {
    const target = await resolveSummaryTarget(db, orgId, { bookmarkId });
    return await loadExtractContext(db, orgId, target);
  } catch (error) {
    console.info("tx-mention context unavailable", { orgId, bookmarkId, error });
    return null;
  }
}

async function loadRecentComments(
  db: postgres.Sql,
  orgId: string,
  bookmarkId: string,
  currentCommentId: string,
): Promise<RecentComment[]> {
  return await db<RecentComment[]>`
    SELECT author, body, file, line
    FROM pr_comments
    WHERE org_id = ${orgId}
      AND bookmark_id = ${bookmarkId}
      AND id <> ${currentCommentId}
    ORDER BY created_at_ms DESC
    LIMIT 8
  `;
}

async function loadGitHubPrFiles(
  input: NonNullable<TxMentionInput["github"]>,
): Promise<GitHubPrFileContext[]> {
  try {
    const token = await getInstallationAccessToken(input.installationId);
    const response = await fetch(
      `https://api.github.com/repos/${input.repoFullName}/pulls/${input.pullNumber}/files?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "gx-server",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      const body = await response.text();
      console.info("tx-mention GitHub PR files unavailable", {
        repoFullName: input.repoFullName,
        pullNumber: input.pullNumber,
        status: response.status,
        body: body.slice(0, 300),
      });
      return [];
    }

    const files = (await response.json()) as Array<{
      filename?: unknown;
      status?: unknown;
      additions?: unknown;
      deletions?: unknown;
      patch?: unknown;
    }>;
    const prUrl = `https://github.com/${input.repoFullName}/pull/${input.pullNumber}`;

    return files
      .flatMap((file) => {
        if (typeof file.filename !== "string" || !file.filename) return [];
        const filename = file.filename;
        const patch = typeof file.patch === "string" ? file.patch : null;
        const base = {
          filename,
          status: typeof file.status === "string" ? file.status : null,
          additions:
            typeof file.additions === "number" ? file.additions : null,
          deletions:
            typeof file.deletions === "number" ? file.deletions : null,
          patch,
        };
        const hunks = parsePatchHunks(patch)
          .filter((hunk) => typeof hunk.newEnd === "number")
          .slice(0, 3);
        if (hunks.length === 0) {
          return [base];
        }
        return hunks.map((hunk) => ({
          ...base,
          lineStart: hunk.newStart,
          lineEnd: hunk.newEnd ?? hunk.newStart,
          url: githubPullFileLineUrl(prUrl, filename, hunk.newStart) ?? undefined,
        }));
      })
      .slice(0, 20);
  } catch (error) {
    console.info("tx-mention GitHub PR files unavailable", {
      repoFullName: input.repoFullName,
      pullNumber: input.pullNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function shouldLoadGitHubPrFiles(context: ExtractContext | null): boolean {
  if (!context) return true;
  const githubPrUrl =
    context.publishedRevisions?.find((revision) => revision.githubPrUrl)
      ?.githubPrUrl ?? null;
  if (!githubPrUrl) return true;
  return !context.hunkLinks.some((hunk) =>
    Boolean(githubPullFileLineUrl(githubPrUrl, hunk.file, hunk.lineStart)),
  );
}

async function generateTxChatReply(input: {
  author: string;
  question: string;
  latestSummary: string | null;
  context: ExtractContext | null;
  githubPrFiles: GitHubPrFileContext[];
  gitBlameContext: GitBlameContext | null;
  recentComments: RecentComment[];
  citationContext: TxCitationContext;
}): Promise<string> {
  const providers = createReviewProviders(input.question || input.latestSummary || "tx mention");
  const userPrompt = buildTxChatUserPrompt({
    ...input,
    citationPromptText: input.citationContext.promptText,
  });
  const runs: ChatRun[] = [];

  for (const provider of providers) {
    try {
      const completion = await provider.complete(TX_CHAT_SYSTEM_PROMPT, userPrompt);
      const structured = parseTxChatModelReply(completion.text);
      const text = structured
        ? formatStructuredChatReply(structured, input.citationContext, provider.name)
        : normalizeChatReply(completion.text);
      runs.push({ text, score: scoreChatReply(text), error: null });
    } catch (error) {
      runs.push({
        text: null,
        score: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const best = runs
    .filter((run): run is ChatRun & { text: string } => Boolean(run.text))
    .sort((a, b) => b.score - a.score)[0];
  if (best) {
    return best.text;
  }

  const failure = runs.find((run) => run.error)?.error;
  return failure
    ? `TX: I couldn't answer from the review context (${failure}).`
    : "TX: I couldn't answer from the available review context.";
}

function formatStructuredChatReply(
  reply: { answer: string; citations: string[] },
  citationContext: TxCitationContext,
  providerName: string,
): string {
  const requestedIds = [...reply.citations, ...inlineCitationIds(reply.answer)];
  const validIds = validCitationIds(requestedIds, citationContext.citations);
  const validIdSet = new Set(validIds);
  const invalidIds = requestedIds.filter((id) => !validIdSet.has(id));

  if (citationContext.citations.length > 0 && validIds.length === 0) {
    console.info("tx-mention sources available but not cited", {
      provider: providerName,
      availableCitationCount: citationContext.citations.length,
      invalidCitationIds: invalidIds,
    });
  } else if (invalidIds.length > 0) {
    console.info("tx-mention dropped invalid citation ids", {
      provider: providerName,
      invalidCitationIds: invalidIds,
    });
  }

  return formatTxCitedReply(reply.answer, validIds, citationContext.citations);
}

function normalizeChatReply(text: string): string {
  const trimmed = text.trim();
  const lines = trimmed
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 8);
  const reply = lines.join("\n").trim();
  if (!reply) {
    return "TX: I couldn't answer from the available review context.";
  }
  return /^tx:/i.test(reply) ? reply : `TX: ${reply}`;
}

function scoreChatReply(text: string): number {
  let score = 1;
  if (/\nSources:\s.*\[S\d+\]/.test(text)) score += 1;
  if (/\[S\d+\]/.test(text)) score += 0.5;
  if (/[\w./-]+\.\w+:\d+/.test(text)) score += 1;
  if (/\b(risk|review|test|security|auth|tenant|payment|llm|prompt|migration|ci)\b/i.test(text)) {
    score += 0.75;
  }
  if (text.split("\n").length <= 6) score += 0.5;
  if (/\bunknown|unclear|not enough\b/i.test(text)) score -= 0.25;
  return score;
}

function stripTxMention(body: string): string {
  return body.replace(/@tx\b[:,]?\s*/gi, "").trim();
}

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

async function authorCanVetoRules(input: TxMentionInput): Promise<boolean> {
  if (!input.github) {
    // No GitHub context means an internal caller, not the public webhook.
    return true;
  }
  const owner = input.github.repoFullName.split("/")[0];
  if (!owner || !input.author || input.author === "unknown") {
    return false;
  }
  try {
    const token = await getInstallationAccessToken(input.github.installationId);
    const response = await fetch(
      `https://api.github.com/repos/${input.github.repoFullName}/collaborators/${encodeURIComponent(input.author)}/permission`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "gx-server",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const decoded = (await response.json()) as { permission?: string };
    return (
      decoded.permission === "admin" ||
      decoded.permission === "maintain" ||
      decoded.permission === "write"
    );
  } catch {
    return false;
  }
}

function extractVetoTarget(body: string): string | null {
  for (const pattern of VETO_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[.!?]+$/, "").trim();
    }
  }
  return null;
}

function pickGitBlameFileHints(
  question: string,
  context: ExtractContext,
  recentComments: RecentComment[],
  currentFile: string | null,
): string[] {
  const files = new Set<string>();
  if (currentFile) files.add(currentFile);

  const lowerQuestion = question.toLowerCase();
  const contextFiles = [
    ...context.hunkLinks.map((hunk) => hunk.file),
    ...(context.changedSymbols ?? []).map((symbol) => symbol.file),
    ...(recentComments.map((comment) => comment.file).filter(Boolean) as string[]),
  ];

  for (const file of contextFiles) {
    if (!file) continue;
    const basename = file.split("/").pop()?.toLowerCase() ?? file.toLowerCase();
    if (
      files.size === 0 ||
      lowerQuestion.includes(file.toLowerCase()) ||
      lowerQuestion.includes(basename.replace(/\.[^.]+$/, "")) ||
      lowerQuestion.includes(basename)
    ) {
      files.add(file);
    }
    if (files.size >= 3) break;
  }

  if (files.size === 0) {
    for (const hunk of context.hunkLinks.slice(0, 3)) {
      files.add(hunk.file);
    }
  }

  return [...files].slice(0, 3);
}
