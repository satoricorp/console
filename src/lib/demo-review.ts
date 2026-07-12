import type { ReviewPlan, ReviewResponse } from "@/lib/reviews-client";

const DEMO_PLAN: ReviewPlan = {
  schemaVersion: 1,
  narrative: {
    summary:
      "Gives the desktop app a real backend. Cloud auth and review data move to a GX-owned Convex deployment, and the desktop review screens stop reading local fixtures and start querying live bookmark and session data. The task was scoped to wiring existing screens to live data; the Convex backend was added along the way once the screens needed reactive queries.",
    summaryTeaser: "Gives the desktop app a real backend.",
    why: "Session tokens are now minted server-side and stored hashed, instead of raw tokens living only in the OS keychain — the agent chose this after hitting CORS limits calling the API directly from the renderer. Reactive Convex queries replace polling so merge status updates without a refresh cycle, and the fixture store is deleted rather than kept as a fallback to avoid a second data path drifting.",
    whyTeaser:
      "Session tokens moved server-side, and reactive queries replaced polling.",
    attributionSources: [
      { source: "agent-sessions", pct: 58 },
      { source: "codebase", pct: 22 },
      { source: "previous-prs", pct: 12 },
      { source: "docs", pct: 8 },
    ],
    selfReportQuote:
      "Wire the desktop review screens to live GX API data sources, replacing the fixture-backed stores. Keep the auth token flow working end-to-end.",
  },
  notableChanges: [
    {
      rank: 1,
      category: "architecture",
      title:
        "Auth trust boundary moves server-side: hashed session tokens replace keychain-only storage",
      whyItMatters:
        "Every future client authenticates against this scheme. Tokens are minted with a 90-day TTL and stored hashed — if the hashing or expiry logic is wrong here, it’s wrong for every device. This was a judgment call the agent made mid-task, not part of the original ask.",
      anchor: {
        file: "services/api/src/routes/auth.ts",
        lineStart: 41,
        lineEnd: 58,
      },
      anchorConfidence: "exact",
      attribution: {
        authorship: "agent",
        tool: "codex",
        model: "gpt-5.5",
      },
    },
    {
      rank: 2,
      category: "pattern",
      title:
        "Review screens switch from fixture stores to reactive queries — the pattern every future screen copies",
      whyItMatters:
        "This sets the data-access idiom for the whole desktop app: subscribe, don’t fetch. The old fixture store is deleted, so there’s no fallback path. Approve the shape of useReviewData and the rest of the diff is mechanical.",
      anchor: {
        file: "apps/desktop/src/renderer/main.jsx",
        lineStart: 112,
        lineEnd: 126,
      },
      anchorConfidence: "exact",
      attribution: {
        authorship: "agent",
        tool: "claude code",
        model: "claude-sonnet-4-6",
      },
    },
  ],
  safeToSkim: [
    {
      file: "apps/desktop/src/renderer/styles.css",
      reason: "Presentational only — tokens for the new review layout",
    },
    {
      file: "apps/desktop/src/renderer/components/ReviewSkeleton.jsx",
      reason: "New loading placeholder, no logic",
    },
    {
      file: "services/api/src/generated/api-types.ts",
      reason: "Generated from the schema — review the schema instead",
    },
    {
      file: "package-lock.json",
      reason: "Lockfile — convex dependency added",
    },
  ],
  revisions: [
    {
      changeId: "demo_rev_1",
      branchName: "gx/add-gx-owned-convex-backend",
      title: "Add GX-owned Convex backend",
    },
  ],
};

const AUTH_PATCH = `--- a/services/api/src/routes/auth.ts
+++ b/services/api/src/routes/auth.ts
@@ -38,9 +41,18 @@ export async function completeCliAuth(req: AuthRequest) {
-  const token = generateToken();
-  await keychain.store(req.machineId, token);
+  const token = \`gxcs_\${randomBytes(32).toString("base64url")}\`;
+  const tokenHash = createHash("sha256").update(token).digest("hex");
+
+  await db.insert("cliSessions", {
+    userId: user._id,
+    tokenHash,
+    machineId: req.machineId,
+    expiresAt: Date.now() + NINETY_DAYS_MS,
+  });
   return { token, expiresInDays: 90 };
`;

const MAIN_PATCH = `--- a/apps/desktop/src/renderer/main.jsx
+++ b/apps/desktop/src/renderer/main.jsx
@@ -108,11 +112,15 @@ function ReviewScreen({ bookmarkId }) {
-  const review = fixtures.reviews[bookmarkId];
-  const [status, setStatus] = useState(review?.status);
-  useEffect(() => pollMergeStatus(bookmarkId, setStatus), [bookmarkId]);
+  const review = useReviewData(bookmarkId);   // reactive: re-renders on push
+  if (review.isLoading) return <ReviewSkeleton />;
+
+  const { plan, usage, mergeStatus } = review;
   return (
+    <ReviewLayout plan={plan} usage={usage} status={mergeStatus}>
`;

export const DEMO_REVIEW: ReviewResponse = (() => {
  const publishedAtMs = Date.now() - 2 * 60 * 60 * 1000;

  return {
    bookmark: {
      id: "bm_demo",
      orgId: "org_demo",
      userId: "user_demo",
      repoFullName: "satoricorp/gx",
      branchName: "gx/add-gx-owned-convex-backend",
      title:
        "Add GX-owned Convex backend for cloud auth and wire desktop review screens to live data",
      revision: 2,
      headCommitId: "1ddbfdb0123456789abcdef0123456789abcdef0",
      remoteHeadSha: "1ddbfdb0123456789abcdef0123456789abcdef0",
      mergeStatus: "open",
      githubPrUrl: "https://github.com/satoricorp/gx/pull/72",
      githubPrNumber: 72,
      publishedAtMs,
      updatedAtMs: publishedAtMs,
      riskLevel: "medium",
      riskScore: 0.45,
      fileCount: 34,
      revisionCount: 2,
      pushedBy: "joe",
    },
    plan: {
      status: "ready",
      stale: false,
      plan: DEMO_PLAN,
      model: "demo",
      provider: "demo",
      generatedAtMs: publishedAtMs,
      error: null,
    },
    usage: {
      totals: {
        inputTokens: 1_842_000,
        outputTokens: 96_400,
        cacheReadTokens: 1_210_000,
        cacheWriteTokens: 88_000,
        totalTokens: 1_938_400,
        costUsd: 4.82,
        unpricedModels: 0,
      },
      byHarness: [
        {
          harness: "codex",
          model: "gpt-5.5",
          sessions: 3,
          inputTokens: 1_420_000,
          outputTokens: 71_200,
          cacheReadTokens: 980_000,
          cacheWriteTokens: 64_000,
          cachedPct: 69,
          costUsd: 3.61,
        },
        {
          harness: "cursor",
          model: "claude-opus-4",
          sessions: 1,
          inputTokens: 422_000,
          outputTokens: 25_200,
          cacheReadTokens: 230_000,
          cacheWriteTokens: 24_000,
          cachedPct: 55,
          costUsd: 1.21,
        },
      ],
      bySession: [],
      unknownModels: [],
    },
    changes: [],
    notablePatches: [
      {
        file: "services/api/src/routes/auth.ts",
        patch: AUTH_PATCH,
        lineStart: 41,
        lineEnd: 58,
      },
      {
        file: "apps/desktop/src/renderer/main.jsx",
        patch: MAIN_PATCH,
        lineStart: 112,
        lineEnd: 126,
      },
    ],
    summary: null,
    activity: [],
    publishContext: {
      repoFullName: "satoricorp/gx",
      headBranch: "gx/add-gx-owned-convex-backend",
      baseBranch: "main",
      localHeadSha: "1ddbfdb0123456789abcdef0123456789abcdef0",
      pullRequestNumber: 72,
      pullRequestUrl: "https://github.com/satoricorp/gx/pull/72",
    },
  };
})();
