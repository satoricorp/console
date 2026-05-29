"use node";

/**
 * Stack structural edits from Console are proxied through Next.js
 * (`/api/bookmarks/:id/split-to-change`) so local gx-cloud on localhost
 * is reachable. This action remains for deployments where GX_CLOUD_API_URL
 * is publicly reachable from Convex.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { authComponent } from "./auth";

function gxCloudApiUrl(): string {
  return (process.env.GX_CLOUD_API_URL ?? "http://localhost:3200").replace(/\/$/, "");
}

function webhookSecret(): string {
  const secret = process.env.GX_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("GX_WEBHOOK_SECRET is not set");
  }
  return secret;
}

const lineRangeValidator = v.object({
  filePath: v.string(),
  side: v.union(v.literal("additions"), v.literal("deletions")),
  startLine: v.number(),
  endLine: v.number(),
});

export const splitToOwnChange = action({
  args: {
    bookmarkId: v.string(),
    jjChangeId: v.string(),
    description: v.optional(v.string()),
    filePaths: v.array(v.string()),
    lineRanges: v.array(lineRangeValidator),
  },
  returns: v.object({
    revision: v.number(),
    eventId: v.optional(v.string()),
    newJjChangeId: v.optional(v.string()),
    headCommitId: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    if (args.filePaths.length === 0 && args.lineRanges.length === 0) {
      throw new Error("Select files or line ranges to split");
    }

    const response = await fetch(
      `${gxCloudApiUrl()}/bookmarks/${encodeURIComponent(args.bookmarkId)}/split-to-change`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GX-User-Id": user._id,
          "X-GX-Webhook-Secret": webhookSecret(),
        },
        body: JSON.stringify({
          jjChangeId: args.jjChangeId,
          description: args.description?.trim() || "Split from review",
          filePaths: args.filePaths,
          lineRanges: args.lineRanges,
        }),
      },
    );

    type SplitResponse = {
      revision?: number;
      eventId?: string;
      newJjChangeId?: string | null;
      headCommitId?: string;
      bookmark?: {
        id: string;
        latest_event_id: string;
        repo_full_name: string;
        branch_name: string;
        title: string | null;
        revision: number;
        merge_status: "open" | "merged" | "closed";
        github_pr_url: string | null;
        github_pr_number: number | null;
        head_commit_id: string | null;
        remote_head_sha: string | null;
        updated_at_ms: number;
      };
      error?: string;
    };

    let payload: SplitResponse;
    try {
      payload = (await response.json()) as SplitResponse;
    } catch {
      throw new Error(`gx-cloud returned invalid JSON (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(payload.error ?? `Split failed (${response.status})`);
    }

    if (!payload.revision || !payload.headCommitId || !payload.bookmark) {
      throw new Error("Split succeeded but response was incomplete");
    }

    return {
      revision: payload.revision,
      eventId: payload.eventId,
      newJjChangeId: payload.newJjChangeId ?? undefined,
      headCommitId: payload.headCommitId,
    };
  },
});
