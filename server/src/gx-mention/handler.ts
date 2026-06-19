import type postgres from "postgres";
import { loadGitBlameContext, type GitBlameContext } from "../github/git-blame";
import { createReviewProviders } from "../llm/provider";
import {
  buildGxChatUserPrompt,
  GX_CHAT_SYSTEM_PROMPT,
} from "../llm/prompts/gx-chat";
import {
  loadExtractContext,
  resolveSummaryTarget,
  type ExtractContext,
} from "../summary/generate";

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

type RecentComment = {
  author: string | null;
  body: string;
  file: string | null;
  line: number | null;
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
  const reply = await generateGxChatReply({
    author: input.author,
    question,
    latestSummary: latestSummary?.content ?? null,
    context,
    gitBlameContext,
    recentComments,
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
    gitBlameRows: gitBlameContext?.rows.length ?? 0,
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

async function generateGxChatReply(input: {
  author: string;
  question: string;
  latestSummary: string | null;
  context: ExtractContext | null;
  gitBlameContext: GitBlameContext | null;
  recentComments: RecentComment[];
}): Promise<string> {
  const providers = createReviewProviders(input.question || input.latestSummary || "gx mention");
  const userPrompt = buildGxChatUserPrompt(input);
  const runs: ChatRun[] = [];

  for (const provider of providers) {
    try {
      const completion = await provider.complete(GX_CHAT_SYSTEM_PROMPT, userPrompt);
      const text = normalizeChatReply(completion.text);
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
