"use node";

import { v } from "convex/values";
import postgres from "postgres";
import { action } from "./_generated/server";
import { authComponent } from "./auth";

const mergeStatusValidator = v.union(
  v.literal("open"),
  v.literal("merged"),
  v.literal("closed"),
);

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}

const bookmarkShape = {
  id: v.string(),
  repoFullName: v.string(),
  branchName: v.string(),
  title: v.optional(v.string()),
  revision: v.number(),
  latestEventId: v.string(),
  headCommitId: v.optional(v.string()),
  githubPrUrl: v.optional(v.string()),
  githubPrNumber: v.optional(v.number()),
  remoteHeadSha: v.optional(v.string()),
  mergeStatus: mergeStatusValidator,
  mergedAtMs: v.optional(v.number()),
  publishedAtMs: v.number(),
  updatedAtMs: v.number(),
  storageBackend: v.string(),
};

export const listMyBookmarks = action({
  args: {
    mergeStatus: v.optional(mergeStatusValidator),
    repoFullName: v.optional(v.string()),
  },
  returns: v.array(v.object(bookmarkShape)),
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
          repo_full_name: string;
          branch_name: string;
          title: string | null;
          revision: number;
          latest_event_id: string;
          head_commit_id: string | null;
          github_pr_url: string | null;
          github_pr_number: number | null;
          remote_head_sha: string | null;
          merge_status: "open" | "merged" | "closed";
          merged_at_ms: string | null;
          published_at_ms: string;
          updated_at_ms: string;
          storage_backend: string;
        }[]
      >`
        SELECT
          id,
          repo_full_name,
          branch_name,
          title,
          revision,
          latest_event_id,
          head_commit_id,
          github_pr_url,
          github_pr_number,
          remote_head_sha,
          merge_status,
          merged_at_ms,
          published_at_ms,
          updated_at_ms,
          storage_backend
        FROM gx_bookmarks
        WHERE user_id = ${user._id}
          ${args.mergeStatus ? sql`AND merge_status = ${args.mergeStatus}` : sql``}
          ${args.repoFullName ? sql`AND repo_full_name = ${args.repoFullName}` : sql``}
        ORDER BY updated_at_ms DESC
      `;

      return rows.map((row) => ({
        id: row.id,
        repoFullName: row.repo_full_name,
        branchName: row.branch_name,
        title: row.title ?? undefined,
        revision: row.revision,
        latestEventId: row.latest_event_id,
        headCommitId: row.head_commit_id ?? undefined,
        githubPrUrl: row.github_pr_url ?? undefined,
        githubPrNumber: row.github_pr_number ?? undefined,
        remoteHeadSha: row.remote_head_sha ?? undefined,
        mergeStatus: row.merge_status,
        mergedAtMs:
          row.merged_at_ms === null ? undefined : Number(row.merged_at_ms),
        publishedAtMs: Number(row.published_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
        storageBackend: row.storage_backend,
      }));
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

export const getBookmarkDetail = action({
  args: {
    bookmarkId: v.string(),
    includePayload: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      ...bookmarkShape,
      payload: v.optional(v.any()),
    }),
  ),
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
          repo_full_name: string;
          branch_name: string;
          title: string | null;
          revision: number;
          latest_event_id: string;
          head_commit_id: string | null;
          github_pr_url: string | null;
          github_pr_number: number | null;
          remote_head_sha: string | null;
          merge_status: "open" | "merged" | "closed";
          merged_at_ms: string | null;
          published_at_ms: string;
          updated_at_ms: string;
          storage_backend: string;
          payload: unknown | null;
        }[]
      >`
        SELECT
          b.id,
          b.repo_full_name,
          b.branch_name,
          b.title,
          b.revision,
          b.latest_event_id,
          b.head_commit_id,
          b.github_pr_url,
          b.github_pr_number,
          b.remote_head_sha,
          b.merge_status,
          b.merged_at_ms,
          b.published_at_ms,
          b.updated_at_ms,
          b.storage_backend,
          ${args.includePayload ? sql`e.payload` : sql`NULL::jsonb`} AS payload
        FROM gx_bookmarks b
        LEFT JOIN gx_pr_events e ON e.id = b.latest_event_id
        WHERE b.id = ${args.bookmarkId}
          AND b.user_id = ${user._id}
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        repoFullName: row.repo_full_name,
        branchName: row.branch_name,
        title: row.title ?? undefined,
        revision: row.revision,
        latestEventId: row.latest_event_id,
        headCommitId: row.head_commit_id ?? undefined,
        githubPrUrl: row.github_pr_url ?? undefined,
        githubPrNumber: row.github_pr_number ?? undefined,
        remoteHeadSha: row.remote_head_sha ?? undefined,
        mergeStatus: row.merge_status,
        mergedAtMs: row.merged_at_ms === null ? undefined : Number(row.merged_at_ms),
        publishedAtMs: Number(row.published_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
        storageBackend: row.storage_backend,
        payload: row.payload ?? undefined,
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

export const getBookmarkIdForEvent = action({
  args: {
    eventId: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const sql = getSql();
    try {
      const rows = await sql<{ id: string }[]>`
        SELECT id
        FROM gx_bookmarks
        WHERE latest_event_id = ${args.eventId}
          AND user_id = ${user._id}
        LIMIT 1
      `;
      return rows[0]?.id ?? null;
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

export const updateBookmarkTitle = action({
  args: {
    bookmarkId: v.string(),
    title: v.string(),
  },
  returns: v.object({
    id: v.string(),
    title: v.string(),
    updatedAtMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      throw new Error("Sign in required");
    }

    const nextTitle = args.title.trim();
    if (!nextTitle) {
      throw new Error("Title is required");
    }
    if (nextTitle.length > 280) {
      throw new Error("Title is too long");
    }

    const now = Date.now();
    const sql = getSql();
    try {
      const rows = await sql<
        {
          id: string;
          title: string;
          updated_at_ms: string;
        }[]
      >`
        UPDATE gx_bookmarks
        SET
          title = ${nextTitle},
          updated_at_ms = ${now}
        WHERE id = ${args.bookmarkId}
          AND user_id = ${user._id}
        RETURNING id, title, updated_at_ms
      `;
      const row = rows[0];
      if (!row) {
        throw new Error("Bookmark not found");
      }
      return {
        id: row.id,
        title: row.title,
        updatedAtMs: Number(row.updated_at_ms),
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});
