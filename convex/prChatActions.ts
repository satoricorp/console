"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { verifyGithubRepoAccess } from "./githubAccess";
import { buildPrChatContext } from "./lib/prChatContext";
import { generateChatResponse } from "./lib/prChat/generateChatResponse";
import { queryReviewContext } from "./lib/turbopuffer/queryReviewContext";

const historyMessage = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

const sourceValidator = v.object({
  file_path: v.string(),
  symbol: v.optional(v.string()),
  content: v.string(),
  commit_id: v.string(),
});

export const sendMessage = action({
  args: {
    bookmarkId: v.string(),
    message: v.string(),
    history: v.array(historyMessage),
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

    const bookmark = await ctx.runQuery(internal.gxPr.getBookmarkWithPayload, {
      userId: user._id,
      postgresBookmarkId: args.bookmarkId,
    });

    if (!bookmark?.payload) {
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
    const prTitle =
      bookmark.title?.trim() || bookmark.branchName || "Untitled PR";

    const search = await queryReviewContext({
      fullName: bookmark.repoFullName,
      changedFiles: prContext.changedFiles,
      query: trimmedMessage,
      prTitle,
      prBody: prContext.prBody,
      sessionSummary: prContext.sessionSummary,
      limit: 8,
    });

    const retrievedChunks = search.results.map((result) => ({
      file_path: result.file_path,
      symbol: result.symbol,
      content: result.content,
      commit_id: result.commit_id,
    }));

    const reply = await generateChatResponse({
      repoFullName: bookmark.repoFullName,
      branchName: bookmark.branchName,
      prTitle,
      prBody: prContext.prBody,
      changedFiles: prContext.changedFiles,
      sessionSummary: prContext.sessionSummary,
      retrievedChunks,
      history: args.history,
      message: trimmedMessage,
    });

    return {
      reply,
      sources: retrievedChunks.map((chunk) => ({
        file_path: chunk.file_path,
        symbol: chunk.symbol,
        content: chunk.content,
        commit_id: chunk.commit_id,
      })),
    };
  },
});
