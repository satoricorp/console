import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

function repoFullNameFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.repoFullName === "string") return record.repoFullName;
  const repo = record.repo;
  if (repo && typeof repo === "object") {
    const repoRecord = repo as Record<string, unknown>;
    if (typeof repoRecord.fullName === "string") return repoRecord.fullName;
    if (
      typeof repoRecord.owner === "string" &&
      typeof repoRecord.name === "string"
    ) {
      return `${repoRecord.owner}/${repoRecord.name}`;
    }
  }
  return undefined;
}

export const ingestPush = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.optional(v.string()),
    payload: v.any(),
  },
  handler: async (ctx, { userId, sessionId, payload }) => {
    await ctx.db.insert("gxPrPushes", {
      userId,
      sessionId,
      repoFullName: repoFullNameFromPayload(payload),
      payload,
      createdAt: Date.now(),
    });
  },
});

export const listMyPushes = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return [];

    const pushes = await ctx.db
      .query("gxPrPushes")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    return pushes
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((push) => ({
        id: push._id,
        sessionId: push.sessionId,
        repoFullName: push.repoFullName,
        payload: push.payload,
        createdAt: push.createdAt,
      }));
  },
});

/** Dev-only: seed a push from the console without running `gx pr`. */
export const seedDemoPush = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    const now = Date.now();

    await ctx.db.insert("gxPrPushes", {
      userId: user._id,
      sessionId: `demo-${now}`,
      repoFullName: "acme/demo",
      payload: {
        title: "Demo PR from console",
        branch: "feature/demo",
        paths: [
          "src/index.ts",
          "src/components/Button.tsx",
          "README.md",
        ],
        patch: `diff --git a/src/index.ts b/src/index.ts
index 1111111..2222222 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function main() {
+  console.log("hello gx");
   return 0;
 }
`,
      },
      createdAt: now,
    });
  },
});
