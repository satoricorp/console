import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Org identity for Convex.
 *
 * Postgres owns this: `orgs.installation_id` is a unique key onto
 * `github_app_installations`, and the server resolves it on every delivery.
 * Convex holds a projection because the namespace an index writes is
 * `gx-{orgId}-{repoSlug}-v2` and Convex previously had no org concept at all —
 * it indexed every repository into one namespace named only after owner/repo,
 * which two orgs with access to the same repository would silently share, and
 * whose commit sweep would have them deleting each other's rows.
 *
 * Writes come from the webhook forward, which carries the org the server
 * already resolved. Nothing here derives an org on its own, so the two systems
 * cannot disagree about who owns an installation.
 */
export const upsertInstallationOrg = internalMutation({
  args: {
    installationId: v.number(),
    orgId: v.string(),
    accountLogin: v.optional(v.string()),
  },
  handler: async (ctx, { installationId, orgId, accountLogin }) => {
    const existing = await ctx.db
      .query("orgInstallations")
      .withIndex("by_installationId", (q) => q.eq("installationId", installationId))
      .unique();

    const fields = { installationId, orgId, accountLogin, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return;
    }
    await ctx.db.insert("orgInstallations", fields);
  },
});

export const getOrgForInstallation = internalQuery({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    const row = await ctx.db
      .query("orgInstallations")
      .withIndex("by_installationId", (q) => q.eq("installationId", installationId))
      .unique();
    return row?.orgId ?? null;
  },
});

