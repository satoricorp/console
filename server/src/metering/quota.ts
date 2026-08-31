import type postgres from "postgres";
import { getCheckoutUrl } from "../billing/stripe";

export type RunKind = "review" | "pr_summary";

export type QuotaCheckResult = {
  allowed: boolean;
  used: number;
  limit: number;
  /** Where to subscribe. Named for the CLI's existing 402 parser. */
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
      result.reason === "free_runs_exhausted"
        ? `gx free runs used up (${result.used}/${result.limit})`
        : result.reason === "trial_expired"
          ? "gx free trial has ended"
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

/**
 * Free trial length for the Postgres org fallback, which only applies to
 * identities Convex does not know (service tokens, local dev). Real users are
 * Convex users and are metered in runs there.
 */
export const BASE_TRIAL_DAYS = 7;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The gx Cloud server's view of one Convex run reservation. */
export type RunReservation = {
  allowed: boolean;
  reason?: string;
  subscribed?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  checkout_url?: string;
};

function convexSiteURL(): string {
  return process.env.CONVEX_SITE_URL?.trim() || "";
}

export function looksLikeConvexUserId(
  userId: string | undefined,
): userId is string {
  if (!userId) return false;
  if (
    userId === "github-webhook" ||
    userId === "local-user" ||
    userId === "system"
  ) {
    return false;
  }
  if (userId.startsWith("github:")) return false;
  return true;
}

/**
 * Ask Convex to reserve one run for the user. Subscribers always pass; free
 * users spend one of their runs, and the same runKey never spends twice.
 * Returns null when Convex is not configured, so callers fall back to the
 * Postgres org window.
 */
export async function reserveRun(input: {
  userId: string;
  kind: RunKind;
  runKey: string;
}): Promise<RunReservation | null> {
  const base = convexSiteURL();
  const apiKey = process.env.GX_CLOUD_API_KEY?.trim();
  if (!base || !apiKey) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/+$/, "")}/cx/runs/reserve`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "gx-cloud",
      },
      body: JSON.stringify({
        user_id: input.userId,
        kind: input.kind,
        run_key: input.runKey,
      }),
    });
  } catch (error) {
    throw new TrialEntitlementUnavailableError(
      `Convex run reservation request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    throw new TrialEntitlementUnavailableError(
      `Convex run reservation returned ${response.status}`,
    );
  }

  return (await response.json()) as RunReservation;
}

function resultFromReservation(
  reservation: RunReservation,
  fallbackUrl: string,
): QuotaCheckResult {
  const upgradeUrl = reservation.checkout_url?.trim() || fallbackUrl;
  const used = reservation.used ?? 0;
  const limit = reservation.limit ?? 0;
  if (!reservation.allowed) {
    return {
      allowed: false,
      used,
      limit,
      upgradeUrl,
      trialEndsAt: null,
      reason: reservation.reason ?? "free_runs_exhausted",
    };
  }
  return {
    allowed: true,
    used,
    limit,
    upgradeUrl,
    trialEndsAt: null,
    reason: reservation.reason ?? "free_run",
  };
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

async function orgFallback(
  db: postgres.Sql,
  orgId: string,
  upgradeUrl: string,
): Promise<QuotaCheckResult> {
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

/** The run key a PR Summary reserves under: one run per bookmark, however many times GitHub delivers it. */
export function prSummaryRunKey(orgId: string, bookmarkId: string): string {
  return `pr_summary:${orgId}:${bookmarkId}`;
}

/**
 * Gate one PR Summary. A bookmark already counted in review_usage never
 * re-spends; otherwise a Convex user spends one run (or is a subscriber), and
 * identities Convex does not know fall back to the org's Postgres window.
 */
export async function checkPrSummaryQuota(
  db: postgres.Sql,
  orgId: string,
  bookmarkId?: string,
  userId?: string,
): Promise<QuotaCheckResult> {
  const upgradeUrl = getCheckoutUrl();

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
    const reservation = await reserveRun({
      userId,
      kind: "pr_summary",
      runKey: bookmarkId
        ? prSummaryRunKey(orgId, bookmarkId)
        : `pr_summary:${orgId}:${crypto.randomUUID()}`,
    });
    if (reservation && reservation.reason !== "unknown_user") {
      return resultFromReservation(reservation, upgradeUrl);
    }
  }

  return orgFallback(db, orgId, upgradeUrl);
}

/**
 * Cloud-AI gate for the model proxy routes. Every call reserves under the
 * run key the CLI sends (X-GX-Run), so the several model calls inside one
 * `gx review` cost one run. A client that sends no key spends a run per call.
 */
export async function checkCloudAIQuota(
  db: postgres.Sql,
  orgId: string,
  userId?: string,
  runKey?: string,
): Promise<QuotaCheckResult> {
  const upgradeUrl = getCheckoutUrl();

  if (looksLikeConvexUserId(userId)) {
    const reservation = await reserveRun({
      userId,
      kind: "review",
      runKey: runKey?.trim() || `call:${crypto.randomUUID()}`,
    });
    if (reservation && reservation.reason !== "unknown_user") {
      return resultFromReservation(reservation, upgradeUrl);
    }
  }

  return orgFallback(db, orgId, upgradeUrl);
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

/** The 402 body every gated route returns, so the CLI sees one shape. */
export function paymentRequiredBody(result: QuotaCheckResult) {
  return {
    error: "payment_required",
    reason: result.reason ?? "free_runs_exhausted",
    message: upgradeMessage(result),
    upgrade_url: result.upgradeUrl,
    checkout_url: result.upgradeUrl,
    used: result.used,
    limit: result.limit,
    trial_ends_at: result.trialEndsAt ?? null,
  };
}

export function upgradeMessage(result: QuotaCheckResult): string {
  if (result.reason === "free_runs_exhausted") {
    const count = result.limit > 0 ? `all ${result.limit}` : "all your";
    return `You've used ${count} free gx runs. Subscribe to keep using gx Cloud AI: ${result.upgradeUrl}`;
  }
  if (result.reason === "trial_expired") {
    return `gx free trial has ended for this org. Subscribe to keep using gx Cloud AI: ${result.upgradeUrl}`;
  }
  return `gx Cloud AI needs a subscription. Subscribe: ${result.upgradeUrl}`;
}
