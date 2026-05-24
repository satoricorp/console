import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const findUserIdForRepo = internalQuery({
  args: { repoFullName: v.string() },
  handler: async (ctx, { repoFullName }) => {
    const repo = await ctx.db
      .query("connectedRepos")
      .filter((q) => q.eq(q.field("fullName"), repoFullName))
      .first();
    return repo?.userId;
  },
});
