import type postgres from "postgres";
import { getInstallationAccessToken } from "../github/app";
import { loadGitBlameContext, parsePatchHunks, type GitBlameContext } from "../github/git-blame";
import { githubPullFileLineUrl } from "../github/line-links";
import { createReviewProviders } from "../llm/provider";
import {
  buildGxChatUserPrompt,
  GX_CHAT_SYSTEM_PROMPT,
  type GitHubPrFileContext,
  type RecentComment,
} from "../llm/prompts/gx-chat";
import {
  loadExtractContext,
  resolveSummaryTarget,
  type ExtractContext,
} from "../summary/generate";
import {
  buildGxCitationContext,
  formatGxCitedReply,
  inlineCitationIds,
  parseGxChatModelReply,
  validCitationIds,
  type GxCitationContext,
} from "./citations";

export type GxMentionInput = {
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

export type GxMentionResult = {
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
  /@gx\s+(?:please\s+)?(?:skip|ignore|veto|override|retire)\s+(?:rule\s+)?(.+)/i,
  /@gx\s+(?:don'?t|do not)\s+enforce\s+(.+)/i,
];

export function containsGxMention(body: string): boolean {
  return /@gx\b/i.test(body);
}

export function parseGxMention(body: string): string | null {
  const match = body.match(/@gx\b/i);
  return match ? body.trim() : null;
}

export async function handleGxMention(
  db: postgres.Sql,
  input: GxMentionInput,
): Promise<GxMentionResult> {
  const vetoTarget = extractVetoTarget(input.body);
  const retiredRuleIds: string[] = [];

  if (vetoTarget) {
    const rules = await db<{ id: string; rule_text: string }[]>`
      SELECT id, rule_text
      FROM rules
      WHERE org_id = ${input.orgId}
        AND status IN ('inferred', 'enforced')
        AND rule_text ILIKE ${"%" + vetoTarget + "%"}
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
        ? `GX: retired ${retiredRuleIds.length} rule(s) matching "${vetoTarget}".`
        : `GX: noted override for "${vetoTarget}" (no matching active rules).`;

    console.info("gx-mention veto", {
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

  const question = stripGxMention(input.body);
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
  const citationContext = buildGxCitationContext({
    latestSummary: latestSummary?.content ?? null,
    context,
    githubPrFiles,
    gitBlameContext,
    recentComments,
  });
  const reply = await generateGxChatReply({
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

  console.info("gx-mention chat", {
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
    console.info("gx-mention context unavailable", { orgId, bookmarkId, error });
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
  input: NonNullable<GxMentionInput["github"]>,
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
      console.info("gx-mention GitHub PR files unavailable", {
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
    console.info("gx-mention GitHub PR files unavailable", {
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

async function generateGxChatReply(input: {
  author: string;
  question: string;
  latestSummary: string | null;
  context: ExtractContext | null;
  githubPrFiles: GitHubPrFileContext[];
  gitBlameContext: GitBlameContext | null;
  recentComments: RecentComment[];
  citationContext: GxCitationContext;
}): Promise<string> {
  const providers = createReviewProviders(input.question || input.latestSummary || "gx mention");
  const userPrompt = buildGxChatUserPrompt({
    ...input,
    citationPromptText: input.citationContext.promptText,
  });
  const runs: ChatRun[] = [];

  for (const provider of providers) {
    try {
      const completion = await provider.complete(GX_CHAT_SYSTEM_PROMPT, userPrompt);
      const structured = parseGxChatModelReply(completion.text);
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
    ? `GX: I couldn't answer from the review context (${failure}).`
    : "GX: I couldn't answer from the available review context.";
}

function formatStructuredChatReply(
  reply: { answer: string; citations: string[] },
  citationContext: GxCitationContext,
  providerName: string,
): string {
  const requestedIds = [...reply.citations, ...inlineCitationIds(reply.answer)];
  const validIds = validCitationIds(requestedIds, citationContext.citations);
  const validIdSet = new Set(validIds);
  const invalidIds = requestedIds.filter((id) => !validIdSet.has(id));

  if (citationContext.citations.length > 0 && validIds.length === 0) {
    console.info("gx-mention sources available but not cited", {
      provider: providerName,
      availableCitationCount: citationContext.citations.length,
      invalidCitationIds: invalidIds,
    });
  } else if (invalidIds.length > 0) {
    console.info("gx-mention dropped invalid citation ids", {
      provider: providerName,
      invalidCitationIds: invalidIds,
    });
  }

  return formatGxCitedReply(reply.answer, validIds, citationContext.citations);
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
    return "GX: I couldn't answer from the available review context.";
  }
  return /^gx:/i.test(reply) ? reply : `GX: ${reply}`;
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

function stripGxMention(body: string): string {
  return body.replace(/@gx\b[:,]?\s*/gi, "").trim();
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
