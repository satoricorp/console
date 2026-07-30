import type postgres from "postgres";
import { getUpgradeCheckoutUrl } from "../billing/stripe";

export type QuotaCheckResult = {
  allowed: boolean;
  used: number;
  limit: number;
  upgradeUrl: string;
  trialEndsAt?: number | null;
  reason?: string;
};

export class QuotaExceededError extends Error {
  readonly used: number;
  readonly limit: number;
  readonly upgradeUrl: string;
  readonly trialEndsAt?: number | null;

  constructor(result: QuotaCheckResult) {
    super(
      result.reason === "trial_expired"
        ? "TX free trial has ended"
        : `PR Summary quota exceeded (${result.used}/${result.limit})`,
    );
    this.name = "QuotaExceededError";
    this.used = result.used;
    this.limit = result.limit;
    this.upgradeUrl = result.upgradeUrl;
    this.trialEndsAt = result.trialEndsAt;
  }
}

export class TrialEntitlementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrialEntitlementUnavailableError";
  }
}

/** Free trial length when Convex entitlement is unavailable. */
export const BASE_TRIAL_DAYS = 7;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

type TrialEntitlement = {
  allowed: boolean;
  reason?: string;
  trialDaysTotal?: number | null;
  trialEndsAt?: number | null;
  startedAt?: number | null;
};

function convexSiteURL(): string {
  return process.env.CONVEX_SITE_URL?.trim() || "";
}

function looksLikeConvexUserId(userId: string | undefined): userId is string {
  if (!userId) return false;
  if (userId === "github-webhook" || userId === "local-user") return false;
  if (userId.startsWith("github:")) return false;
  return true;
}

async function fetchTrialEntitlement(
  userId: string,
): Promise<TrialEntitlement | null> {
  const base = convexSiteURL();
  const apiKey = process.env.TX_CLOUD_API_KEY?.trim();
  if (!base || !apiKey) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/+$/, "")}/cx/trial/entitlement`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "tx-cloud",
      },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (error) {
    throw new TrialEntitlementUnavailableError(
      `Convex trial entitlement request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    throw new TrialEntitlementUnavailableError(
      `Convex trial entitlement returned ${response.status}`,
    );
  }

  return (await response.json()) as TrialEntitlement;
}

async function orgTrialAllowed(
  db: postgres.Sql,
  orgId: string,
): Promise<{ allowed: boolean; trialEndsAt: number; plan: string }> {
  const [org] = await db<{ created_at_ms: number | string; plan: string }[]>`
    SELECT created_at_ms, plan
    FROM orgs
    WHERE id = ${orgId}::uuid
  `;

  if (!org) {
    return { allowed: false, trialEndsAt: 0, plan: "free" };
  }

  if (org.plan !== "free") {
    return {
      allowed: true,
      trialEndsAt: Number(org.created_at_ms),
      plan: org.plan,
    };
  }

  const trialEndsAt =
    Number(org.created_at_ms) + BASE_TRIAL_DAYS * MS_PER_DAY;
  return {
    allowed: Date.now() < trialEndsAt,
    trialEndsAt,
    plan: org.plan,
  };
}

/** Allow unlimited PR Summaries during the free trial window. */
export async function checkPrSummaryQuota(
  db: postgres.Sql,
  orgId: string,
  bookmarkId?: string,
  userId?: string,
): Promise<QuotaCheckResult> {
  const upgradeUrl = getUpgradeCheckoutUrl(orgId);

  let alreadyCounted = false;
  if (bookmarkId) {
    const [existing] = await db<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM review_usage
        WHERE org_id = ${orgId} AND bookmark_id = ${bookmarkId}
      ) AS exists
    `;
    alreadyCounted = existing?.exists ?? false;
  }

  if (alreadyCounted) {
    return {
      allowed: true,
      used: 0,
      limit: 0,
      upgradeUrl,
      reason: "already_counted",
    };
  }

  if (looksLikeConvexUserId(userId)) {
    const entitlement = await fetchTrialEntitlement(userId);
    if (entitlement && entitlement.reason !== "unknown_user") {
      if (!entitlement.allowed) {
        return {
          allowed: false,
          used: 0,
          limit: 0,
          upgradeUrl,
          trialEndsAt: entitlement.trialEndsAt,
          reason: "trial_expired",
        };
      }
      return {
        allowed: true,
        used: 0,
        limit: 0,
        upgradeUrl,
        trialEndsAt: entitlement.trialEndsAt,
        reason: entitlement.reason ?? "trial",
      };
    }
  }

  const orgTrial = await orgTrialAllowed(db, orgId);
  if (orgTrial.allowed) {
    return {
      allowed: true,
      used: 0,
      limit: 0,
      upgradeUrl,
      trialEndsAt: orgTrial.trialEndsAt,
      reason: orgTrial.plan === "free" ? "org_trial" : "paid_plan",
    };
  }

  return {
    allowed: false,
    used: 0,
    limit: 0,
    upgradeUrl,
    trialEndsAt: orgTrial.trialEndsAt,
    reason: "trial_expired",
  };
}

/**
 * Cloud-AI access gate for the OpenAI proxy routes. Same entitlement chain as
 * PR Summaries (Convex trial entitlement, then org plan/trial window) without
 * the per-bookmark usage bookkeeping.
 */
export async function checkCloudAIQuota(
  db: postgres.Sql,
  orgId: string,
  userId?: string,
): Promise<QuotaCheckResult> {
  return checkPrSummaryQuota(db, orgId, undefined, userId);
}

export async function assertPrSummaryQuota(
  db: postgres.Sql,
  orgId: string,
  bookmarkId?: string,
  userId?: string,
): Promise<QuotaCheckResult> {
  const result = await checkPrSummaryQuota(db, orgId, bookmarkId, userId);
  if (!result.allowed) {
    throw new QuotaExceededError(result);
  }
  return result;
}

export async function recordPrSummaryUsage(
  db: postgres.Sql,
  input: {
    orgId: string;
    userId: string;
    bookmarkId: string;
    eventId: string;
  },
): Promise<void> {
  const now = Date.now();
  await db`
    INSERT INTO review_usage (
      org_id, user_id, bookmark_id, first_event_id, counted_at_ms
    ) VALUES (
      ${input.orgId},
      ${input.userId},
      ${input.bookmarkId},
      ${input.eventId},
      ${now}
    )
    ON CONFLICT (org_id, bookmark_id) DO NOTHING
  `;
}

export function upgradeMessage(result: QuotaCheckResult): string {
  if (result.reason === "trial_expired") {
    return [
      "TX free trial has ended for this org.",
      "Unlimited reviews during your trial week — upgrade to keep going.",
      `Upgrade: ${result.upgradeUrl}`,
    ].join("\n");
  }

  return [
    "TX PR Summary quota reached for this org.",
    `Upgrade: ${result.upgradeUrl}`,
  ].join("\n");
}
