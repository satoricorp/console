"use node";

import { v } from "convex/values";
import postgres from "postgres";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { verifyGithubRepoAccess } from "./githubAccess";
import { buildPrChatContext, buildSessionSummaryForPins } from "./lib/prChatContext";
import { chatPinValidator } from "./lib/chatPin";
import { generateChatResponse } from "./lib/prChat/generateChatResponse";
import { queryReviewContext } from "./lib/turbopuffer/queryReviewContext";

const historyMessage = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

const sourceValidator = v.object({
  file_path: v.string(),
  symbol: v.optional(v.string()),
  start_line: v.optional(v.number()),
  end_line: v.optional(v.number()),
  content: v.string(),
  commit_id: v.string(),
});

const pinValidator = v.object(chatPinValidator);

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}

async function loadBookmarkPayloadFromPostgres(
  userId: string,
  bookmarkId: string,
): Promise<{
  repoFullName: string;
  branchName: string;
  title?: string;
  payload: unknown;
} | null> {
  const sql = getSql();
  try {
    const rows = await sql<
      {
        repo_full_name: string;
        branch_name: string;
        title: string | null;
        payload: unknown | null;
      }[]
    >`
      SELECT
        b.repo_full_name,
        b.branch_name,
        b.title,
        e.payload
      FROM gx_bookmarks b
      LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
      WHERE b.id = ${bookmarkId}
        AND b.user_id = ${userId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row?.payload) {
      return null;
    }

    return {
      repoFullName: row.repo_full_name,
      branchName: row.branch_name,
      title: row.title ?? undefined,
      payload: row.payload,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export const sendMessage = action({
  args: {
    bookmarkId: v.string(),
    message: v.string(),
    history: v.array(historyMessage),
    pins: v.optional(v.array(pinValidator)),
  },
  returns: v.object({
    reply: v.string(),
    sources: v.array(sourceValidator),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    const trimmedMessage = args.message.trim();
    if (!trimmedMessage) {
      throw new Error("Message is required.");
    }

    const bookmark = await loadBookmarkPayloadFromPostgres(
      user._id,
      args.bookmarkId,
    );
    if (!bookmark) {
      throw new Error("Bookmark not found or missing payload. Run gx pr to sync.");
    }

    const grant = await ctx.runQuery(internal.repos.getConnectedRepo, {
      userId: user._id,
      fullName: bookmark.repoFullName,
    });

    if (!grant) {
      throw new Error(
        `Connect ${bookmark.repoFullName} in settings before using PR chat.`,
      );
    }

    const verification = await verifyGithubRepoAccess(
      ctx,
      user._id,
      bookmark.repoFullName,
    );

    if (!verification.ok) {
      await ctx.runMutation(internal.repos.revokeRepoAccess, {
        userId: user._id,
        fullName: bookmark.repoFullName,
      });
      throw new Error(verification.message);
    }

    await ctx.runMutation(internal.repos.touchRepoAccessVerified, {
      userId: user._id,
      fullName: bookmark.repoFullName,
      accessVerifiedAt: Date.now(),
      defaultBranch: verification.defaultBranch,
    });

    const prContext = buildPrChatContext(bookmark.payload);
    const pins = args.pins ?? [];
    const pinnedFiles = [...new Set(pins.map((pin) => pin.filePath))];
    const sessionSummary =
      buildSessionSummaryForPins(bookmark.payload, pinnedFiles) ??
      prContext.sessionSummary;
    const prTitle =
      bookmark.title?.trim() || bookmark.branchName || "Untitled PR";

    const search = await queryReviewContext({
      fullName: bookmark.repoFullName,
      changedFiles: prContext.changedFiles,
      query: trimmedMessage,
      prTitle,
      prBody: prContext.prBody,
      sessionSummary,
      pinnedSelections: pins.map((pin) => ({
        filePath: pin.filePath,
        startLine: pin.startLine,
        endLine: pin.endLine,
        text: pin.text,
      })),
      limit: 8,
    });

    const retrievedChunks = search.results.map((result) => ({
      file_path: result.file_path,
      symbol: result.symbol,
      start_line: result.start_line,
      end_line: result.end_line,
      content: result.content,
      commit_id: result.commit_id,
    }));

    const reply = await generateChatResponse({
      repoFullName: bookmark.repoFullName,
      branchName: bookmark.branchName,
      prTitle,
      prBody: prContext.prBody,
      changedFiles: prContext.changedFiles,
      sessionSummary,
      pinnedSelections: pins,
      retrievedChunks,
      history: args.history,
      message: trimmedMessage,
    });

    return {
      reply,
      sources: retrievedChunks.map((chunk) => ({
        file_path: chunk.file_path,
        symbol: chunk.symbol,
        start_line: chunk.start_line,
        end_line: chunk.end_line,
        content: chunk.content,
        commit_id: chunk.commit_id,
      })),
    };
  },
});
