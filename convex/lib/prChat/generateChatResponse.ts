"use node";

import OpenAI from "openai";
import { withRetry } from "../turbopuffer/retry";

const MODEL = "gpt-4o-mini";

let openai: OpenAI | null = null;

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RetrievedChunk = {
  file_path: string;
  symbol?: string;
  start_line?: number;
  end_line?: number;
  content: string;
  commit_id: string;
};

export type GenerateChatResponseRequest = {
  repoFullName: string;
  branchName: string;
  prTitle: string;
  prBody?: string;
  changedFiles: string[];
  sessionSummary?: string;
  pinnedSelections?: Array<{
    filePath: string;
    side: "additions" | "deletions";
    startLine: number;
    endLine: number;
    text: string;
  }>;
  retrievedChunks: RetrievedChunk[];
  history: ChatHistoryMessage[];
  message: string;
};

function formatRetrievedChunks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "No indexed code snippets were retrieved for this question.";
  }

  return chunks
    .map((chunk, index) => {
      const lineLabel =
        chunk.start_line && chunk.end_line
          ? chunk.start_line === chunk.end_line
            ? `:${chunk.start_line}`
            : `:${chunk.start_line}-${chunk.end_line}`
          : "";
      const header = [
        `[${index + 1}] ${chunk.file_path}${lineLabel}`,
        chunk.symbol ? ` (${chunk.symbol})` : "",
        chunk.commit_id ? ` @ ${chunk.commit_id.slice(0, 12)}` : "",
      ].join("");
      return `${header}\n${chunk.content}`;
    })
    .join("\n\n---\n\n");
}

function formatPinnedSelections(
  pins: NonNullable<GenerateChatResponseRequest["pinnedSelections"]>,
): string {
  if (pins.length === 0) return "No code pinned for this question.";

  return pins
    .map((pin) => {
      const lineLabel =
        pin.startLine === pin.endLine
          ? `${pin.startLine}`
          : `${pin.startLine}-${pin.endLine}`;
      const sideLabel = pin.side === "additions" ? "new" : "old";
      return `[${pin.filePath}:${lineLabel} (${sideLabel})]\n${pin.text}`;
    })
    .join("\n\n---\n\n");
}

function buildSystemPrompt(request: GenerateChatResponseRequest): string {
  const changedFiles =
    request.changedFiles.length > 0
      ? request.changedFiles.join(", ")
      : "none listed";

  return [
    "You are a PR review assistant embedded in the GX console.",
    "Answer questions about the pull request using the PR metadata, agent session history, and retrieved repository code.",
    "Only use the attached repository for this PR; do not invent files or APIs.",
    "If the answer is not in the provided context, say what is missing instead of guessing.",
    "Prefer concise, actionable answers. Reference file paths when citing code.",
    "",
    `Repository: ${request.repoFullName}`,
    `Branch: ${request.branchName}`,
    `PR title: ${request.prTitle}`,
    `Changed files: ${changedFiles}`,
    request.prBody ? `\nPR description:\n${request.prBody}` : "",
    request.sessionSummary
      ? `\nAgent sessions from gx pr:\n${request.sessionSummary}`
      : "",
    request.pinnedSelections && request.pinnedSelections.length > 0
      ? `\nUser pinned code (prioritize this when answering):\n${formatPinnedSelections(request.pinnedSelections)}`
      : "",
    `\nRetrieved code:\n${formatRetrievedChunks(request.retrievedChunks)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateChatResponse(
  request: GenerateChatResponseRequest,
): Promise<string> {
  const client = getOpenAI();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(request) },
    ...request.history.map((entry) => ({
      role: entry.role,
      content: entry.content,
    })),
    { role: "user", content: request.message },
  ];

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.2,
      }),
    { maxAttempts: 3, baseMs: 1000 },
  );

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("The model returned an empty response.");
  }

  return content;
}
