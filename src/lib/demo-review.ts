import type { ReviewListItem } from "@/components/reviews/reviews-list";
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
        rank: 1,
        file: "services/api/src/routes/auth.ts",
        patch: AUTH_PATCH,
        lineStart: 41,
        lineEnd: 58,
      },
      {
        rank: 2,
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

type DemoReviewSpec = {
  id: string;
  repo: string;
  branch: string;
  title: string;
  summary: string;
  why: string;
  notableTitle: string;
  notableWhy: string;
  file: string;
  files: number;
  risk: "low" | "medium" | "high";
  pr: number;
};

const DEMO_REVIEW_SPECS: DemoReviewSpec[] = [
  {
    id: "demo-auth-sessions",
    repo: "acme/console",
    branch: "feat/session-hardening",
    title: "Harden session rotation and device revocation",
    summary:
      "Moves session rotation behind a single server-side boundary and adds device-level revocation without changing the sign-in flow.",
    why: "The previous client-managed rotation path could leave two valid tokens after a network retry. The new transaction makes rotation atomic.",
    notableTitle: "Session rotation is now atomic",
    notableWhy:
      "Authentication correctness depends on this transaction. Review the token invalidation order before the surrounding UI changes.",
    file: "server/auth/rotate-session.ts",
    files: 14,
    risk: "high",
    pr: 418,
  },
  {
    id: "demo-billing-usage",
    repo: "acme/console",
    branch: "feat/usage-breakdown",
    title: "Add per-workspace usage breakdowns",
    summary:
      "Adds a workspace-level cost view with cached token totals and daily model attribution.",
    why: "Support needed a way to explain invoice changes without querying raw events. The aggregate is updated as usage arrives.",
    notableTitle: "Usage aggregation becomes incremental",
    notableWhy:
      "This avoids rescanning the event table, but makes event deduplication part of the billing correctness boundary.",
    file: "convex/usageAggregates.ts",
    files: 19,
    risk: "medium",
    pr: 421,
  },
  {
    id: "demo-invite-flow",
    repo: "acme/console",
    branch: "fix/invite-expiry",
    title: "Fix expired organization invite handling",
    summary:
      "Expired invitations now land on a recoverable state instead of failing after the user completes authentication.",
    why: "Invite validity was checked before sign-in but not after the OAuth round trip, creating a confusing dead end.",
    notableTitle: "Invite expiry is rechecked after OAuth",
    notableWhy:
      "The second check closes a timing gap while preserving the original organization and inviter context.",
    file: "src/app/invite/[token]/page.tsx",
    files: 7,
    risk: "low",
    pr: 426,
  },
  {
    id: "demo-review-cache",
    repo: "acme/gx",
    branch: "perf/review-plan-cache",
    title: "Cache review plans by surviving diff",
    summary:
      "Reuses review plans when a republish produces the same surviving patch, cutting repeated model work.",
    why: "Formatting-only commits frequently regenerated identical plans. The cache key now follows the reviewed evidence rather than the head SHA.",
    notableTitle: "Cache identity moves from commit to evidence",
    notableWhy:
      "A collision would show a plan for the wrong code, so the canonical patch serialization is the critical review point.",
    file: "server/src/review-plan/cache-key.ts",
    files: 11,
    risk: "medium",
    pr: 88,
  },
  {
    id: "demo-stack-publish",
    repo: "acme/gx",
    branch: "feat/stack-publish",
    title: "Publish stacked revisions in dependency order",
    summary:
      "Adds stack-aware publishing so dependent revisions reach the remote in topological order.",
    why: "Parallel pushes made child revisions briefly reference missing parents. The publisher now validates and sequences the stack.",
    notableTitle: "Publishing now has an explicit dependency graph",
    notableWhy:
      "Cycle detection and partial-failure recovery determine whether a stack can be resumed safely.",
    file: "crates/gx/src/publish/stack.rs",
    files: 23,
    risk: "high",
    pr: 91,
  },
  {
    id: "demo-review-comments",
    repo: "acme/gx",
    branch: "feat/review-comments",
    title: "Attach reviewer comments to revision anchors",
    summary:
      "Persists review comments against stable revision anchors and carries them forward when lines still match.",
    why: "Comments previously disappeared from the useful context after a republish. Anchor remapping preserves intent across revisions.",
    notableTitle: "Comment anchors survive republish",
    notableWhy:
      "The fuzzy fallback can attach feedback to the wrong block; exact matching remains preferred and ambiguity is surfaced.",
    file: "server/src/comments/remap.ts",
    files: 16,
    risk: "medium",
    pr: 95,
  },
  {
    id: "demo-cli-output",
    repo: "acme/gx",
    branch: "chore/quiet-publish-output",
    title: "Make publish output concise in interactive terminals",
    summary:
      "Reworks publish progress into a compact terminal summary while retaining structured output for automation.",
    why: "Verbose transport logs obscured the revision and PR links developers need after publishing.",
    notableTitle: "TTY and machine output paths are separated",
    notableWhy:
      "CI consumers keep stable JSON while interactive users get the new concise renderer.",
    file: "crates/gx/src/output/publish.rs",
    files: 9,
    risk: "low",
    pr: 97,
  },
  {
    id: "demo-desktop-updater",
    repo: "acme/desktop",
    branch: "feat/signed-updates",
    title: "Verify desktop updates before installation",
    summary:
      "Adds signature verification and staged rollout metadata to the desktop updater.",
    why: "The existing checksum protected against corruption but not a compromised download origin. Updates now require a trusted signature.",
    notableTitle: "Update authenticity is enforced before unpacking",
    notableWhy:
      "Key rotation and verification failure behavior are the security-critical paths in this change.",
    file: "apps/desktop/src/main/updater.ts",
    files: 18,
    risk: "high",
    pr: 203,
  },
  {
    id: "demo-command-palette",
    repo: "acme/desktop",
    branch: "feat/command-palette",
    title: "Add a keyboard-first command palette",
    summary:
      "Introduces a searchable command palette for navigation, review actions, and workspace switching.",
    why: "Frequent actions were split across menus. A registry now gives keyboard and menu surfaces one source of truth.",
    notableTitle: "Commands move into a shared registry",
    notableWhy:
      "Permissions and availability are evaluated centrally, preventing shortcuts from bypassing disabled UI actions.",
    file: "apps/desktop/src/renderer/commands/registry.ts",
    files: 27,
    risk: "medium",
    pr: 207,
  },
  {
    id: "demo-offline-drafts",
    repo: "acme/desktop",
    branch: "feat/offline-review-drafts",
    title: "Preserve review drafts while offline",
    summary:
      "Stores review drafts locally and reconciles them when connectivity returns.",
    why: "A transient disconnect could discard long review notes. Drafts now use revision-aware conflict detection before upload.",
    notableTitle: "Offline drafts use revision-aware reconciliation",
    notableWhy:
      "The merge policy protects newer remote feedback and surfaces conflicts instead of silently overwriting either side.",
    file: "apps/desktop/src/renderer/reviews/draft-sync.ts",
    files: 12,
    risk: "medium",
    pr: 211,
  },
];

const DEMO_NOW = Date.UTC(2026, 6, 14, 15, 0, 0);

function buildDemoReview(spec: DemoReviewSpec, index: number): ReviewResponse {
  const publishedAtMs = DEMO_NOW - (index + 1) * 3_600_000;
  const sha = `${(index + 1).toString(16).repeat(40)}`.slice(0, 40);
  const safeFile = spec.file.replace(/\.[^.]+$/, ".test$&");
  const baseNotable = DEMO_PLAN.notableChanges[0]!;

  return {
    ...DEMO_REVIEW,
    bookmark: {
      ...DEMO_REVIEW.bookmark,
      id: spec.id,
      repoFullName: spec.repo,
      branchName: spec.branch,
      title: spec.title,
      revision: (index % 3) + 1,
      headCommitId: sha,
      remoteHeadSha: sha,
      githubPrUrl: `https://github.com/${spec.repo}/pull/${spec.pr}`,
      githubPrNumber: spec.pr,
      publishedAtMs,
      updatedAtMs: publishedAtMs,
      riskLevel: spec.risk,
      riskScore: spec.risk === "high" ? 0.82 : spec.risk === "medium" ? 0.48 : 0.16,
      fileCount: spec.files,
      revisionCount: (index % 3) + 1,
      pushedBy: ["maya", "noah", "priya", "sam"][index % 4]!,
    },
    plan: {
      ...DEMO_REVIEW.plan,
      generatedAtMs: publishedAtMs + 90_000,
      plan: {
        ...DEMO_PLAN,
        narrative: {
          ...DEMO_PLAN.narrative,
          summary: spec.summary,
          summaryTeaser: spec.summary,
          why: spec.why,
          whyTeaser: spec.why,
          selfReportQuote: `Implement ${spec.title.toLowerCase()} and keep the change focused on the existing product flow.`,
        },
        notableChanges: [
          {
            ...baseNotable,
            title: spec.notableTitle,
            whyItMatters: spec.notableWhy,
            anchor: { file: spec.file, lineStart: 24, lineEnd: 61 },
            attribution: {
              authorship: "agent",
              tool: index % 2 === 0 ? "cursor" : "claude code",
              model: index % 2 === 0 ? "gpt-5.5" : "claude-sonnet-4-6",
            },
          },
        ],
        safeToSkim: [
          { file: safeFile, reason: "Focused coverage for the behavior above" },
          { file: "bun.lock", reason: "Generated lockfile update" },
        ],
        revisions: [
          {
            changeId: `${spec.id}-revision`,
            branchName: spec.branch,
            title: spec.title,
          },
        ],
      },
    },
    usage: {
      ...DEMO_REVIEW.usage!,
      totals: {
        ...DEMO_REVIEW.usage!.totals,
        totalTokens: 180_000 + index * 73_000,
        inputTokens: 165_000 + index * 68_000,
        outputTokens: 15_000 + index * 5_000,
        costUsd: Number((0.72 + index * 0.31).toFixed(2)),
      },
    },
    notablePatches: [
      {
        rank: 1,
        file: spec.file,
        lineStart: 24,
        lineEnd: 61,
        patch: `--- a/${spec.file}
+++ b/${spec.file}
@@ -24,3 +24,7 @@
-  return legacyBehavior(input);
+  const result = await applyReviewedChange(input);
+  if (!result.ok) {
+    throw new Error(result.message);
+  }
+  return result.value;
`,
      },
    ],
    activity: [
      {
        kind: "push",
        id: `${spec.id}-push`,
        atMs: publishedAtMs,
        title: "Revision published",
        detail: sha.slice(0, 7),
      },
      {
        kind: "plan",
        id: `${spec.id}-plan`,
        atMs: publishedAtMs + 90_000,
        title: "Review plan generated",
        detail: `${spec.files} files`,
      },
      {
        kind: "ci",
        id: `${spec.id}-ci`,
        atMs: publishedAtMs + 8 * 60_000,
        title: "CI checks passed",
        detail: "12/12",
      },
    ],
    publishContext: {
      repoFullName: spec.repo,
      headBranch: spec.branch,
      baseBranch: "main",
      localHeadSha: sha,
      pullRequestNumber: spec.pr,
      pullRequestUrl: `https://github.com/${spec.repo}/pull/${spec.pr}`,
    },
  };
}

export const DEMO_REVIEWS = DEMO_REVIEW_SPECS.map(buildDemoReview);

export const DEMO_REVIEW_LIST: ReviewListItem[] = DEMO_REVIEWS.map((review) => ({
  id: review.bookmark.id,
  repo_full_name: review.bookmark.repoFullName,
  branch_name: review.bookmark.branchName,
  title: review.bookmark.title,
  revision: review.bookmark.revision,
  merge_status: review.bookmark.mergeStatus,
  updated_at_ms: review.bookmark.updatedAtMs,
  github_pr_url: review.bookmark.githubPrUrl,
  github_pr_number: review.bookmark.githubPrNumber,
  latest_event_id: `${review.bookmark.id}-event`,
  file_count: review.bookmark.fileCount,
  archived_at_ms: null,
  plan_status: review.plan.status,
  plan_error: review.plan.error,
}));

export function getDemoReview(bookmarkId: string): ReviewResponse | null {
  return (
    DEMO_REVIEWS.find((review) => review.bookmark.id === bookmarkId) ?? null
  );
}
