"use node";

import { v } from "convex/values";
import postgres from "postgres";
import { action } from "./_generated/server";
import { authComponent } from "./auth";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}

export const getReviewEvent = action({
  args: {
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const sql = getSql();
    try {
      const rows = await sql<
        {
          id: string;
          event: string;
          created_at_ms: string;
          ingested_at: Date;
          gx_version: string;
          user_id: string | null;
          github_user_login: string | null;
          remote_url: string | null;
          branch_name: string | null;
          head_commit_id: string;
          github_pr_url: string | null;
          payload: unknown;
        }[]
      >`
        SELECT *
        FROM gx_pr_events
        WHERE id = ${args.eventId}
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      if (row.user_id !== user._id) {
        throw new Error("Not found");
      }

      return {
        id: row.id,
        event: row.event,
        created_at_ms: Number(row.created_at_ms),
        ingested_at: row.ingested_at.toISOString(),
        gx_version: row.gx_version,
        github_user_login: row.github_user_login,
        remote_url: row.remote_url,
        branch_name: row.branch_name,
        head_commit_id: row.head_commit_id,
        github_pr_url: row.github_pr_url,
        payload: row.payload,
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});
