"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { verifyGithubRepoAccess } from "./githubAccess";
import { chatPinValidator } from "./lib/chatPin";
import { generateChatResponse } from "./lib/prChat/generateChatResponse";
import {
  queryReviewContext,
  type QueryReviewContextResult,
} from "./lib/turbopuffer/queryReviewContext";
import { prChatContextValidator } from "./lib/bookmarkActionContext";

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

export const sendMessage = action({
  args: {
    bookmarkId: v.string(),
    message: v.string(),
    history: v.array(historyMessage),
    pins: v.optional(v.array(pinValidator)),
    prChatContext: prChatContextValidator,
    repoFullName: v.string(),
    branchName: v.string(),
    title: v.optional(v.string()),
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

    const grant = await ctx.runQuery(internal.repos.getConnectedRepo, {
      userId: user._id,
      fullName: args.repoFullName,
    });

    if (!grant) {
      throw new Error(
        `Connect ${args.repoFullName} in settings before using PR chat.`,
      );
    }

    const verification = await verifyGithubRepoAccess(
      ctx,
      user._id,
      args.repoFullName,
    );

    // Do not revoke connectedRepos on read-time checks.
    // Transient 403/rate-limit responses would otherwise empty grants and
    // bounce returning users back through onboarding.
    if (!verification.ok) {
      throw new Error(verification.message);
    }

    await ctx.runMutation(internal.repos.touchRepoAccessVerified, {
      userId: user._id,
      fullName: args.repoFullName,
      accessVerifiedAt: Date.now(),
      defaultBranch: verification.defaultBranch,
    });

    const prContext = args.prChatContext;
    const pins = args.pins ?? [];
    const prTitle = args.title?.trim() || args.branchName || "Untitled PR";

    // No org means no namespace to search; the chat still answers, just
    // without indexed source behind it.
    const search: QueryReviewContextResult = grant.orgId
      ? await queryReviewContext({
      orgId: grant.orgId,
      fullName: args.repoFullName,
      changedFiles: prContext.changedFiles,
      query: trimmedMessage,
      prTitle,
      prBody: prContext.prBody,
      sessionSummary: prContext.sessionSummary,
      pinnedSelections: pins.map((pin) => ({
        filePath: pin.filePath,
        startLine: pin.startLine,
        endLine: pin.endLine,
        text: pin.text,
      })),
      limit: 8,
        })
      : { results: [] };

    const retrievedChunks = search.results.map((result) => ({
      file_path: result.file_path,
      symbol: result.symbol,
      start_line: result.start_line,
      end_line: result.end_line,
      content: result.content,
      commit_id: result.commit_id,
    }));

    const reply = await generateChatResponse({
      repoFullName: args.repoFullName,
      branchName: args.branchName,
      prTitle,
      prBody: prContext.prBody,
      changedFiles: prContext.changedFiles,
      sessionSummary: prContext.sessionSummary,
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