import { v } from "convex/values";
import { query } from "./_generated/server";
import { authComponent } from "./auth";
import { patchFromPayload } from "./lib/gxPrPayload";

/**
 * Public revision lookup for gx.run/r/<changeId>.
 *
 * Access rules:
 * - Revision in a public connected repo: visible to everyone.
 * - Otherwise: visible to the uploader and to users who have connected the
 *   same repo (their GitHub access was verified at connect time).
 * - No access and not found return the same `null` so the page cannot leak
 *   which change ids exist.
 */
export const getByChangeId = query({
  args: { changeId: v.string() },
  handler: async (ctx, { changeId }) => {
    const trimmed = changeId.trim();
    if (!trimmed) return null;

    const rows = await ctx.db
      .query("gxRevisions")
      .withIndex("by_changeId", (q) => q.eq("changeId", trimmed))
      .collect();
    if (rows.length === 0) return null;

    const revision = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
    const user = await authComponent.safeGetAuthUser(ctx);

    let allowed = user ? revision.userId === user._id : false;
    if (!allowed && revision.repoFullName) {
      const repo = await ctx.db
        .query("connectedRepos")
        .withIndex("by_fullName", (q) =>
          q.eq("fullName", revision.repoFullName!),
        )
        .first();
      if (repo && !repo.private) {
        allowed = true;
      } else if (user) {
        const mine = await ctx.db
          .query("connectedRepos")
          .withIndex("by_userId_fullName", (q) =>
            q.eq("userId", user._id).eq("fullName", revision.repoFullName!),
          )
          .first();
        allowed = Boolean(mine);
      }
    }
    if (!allowed) return null;

    const push = await ctx.db.get(revision.pushId);
    const patch = push ? patchFromPayload(push.payload, revision.changeId) : null;

    return {
      changeId: revision.changeId,
      commitId: revision.commitId ?? null,
      repoFullName: revision.repoFullName ?? null,
      message: revision.message,
      branchName: revision.branchName ?? null,
      baseBranchName: revision.baseBranchName ?? null,
      pullRequestUrl: revision.pullRequestUrl ?? null,
      createdAt: revision.createdAt,
      patch,
    };
  },
});
