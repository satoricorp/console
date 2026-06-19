import type postgres from "postgres";
import { getUpgradeCheckoutUrl } from "../billing/stripe";

export type QuotaCheckResult = {
  allowed: boolean;
  used: number;
  limit: number;
  upgradeUrl: string;
};

export class QuotaExceededError extends Error {
  readonly used: number;
  readonly limit: number;
  readonly upgradeUrl: string;

  constructor(result: QuotaCheckResult) {
    super(`PR Summary quota exceeded (${result.used}/${result.limit})`);
    this.name = "QuotaExceededError";
    this.used = result.used;
    this.limit = result.limit;
    this.upgradeUrl = result.upgradeUrl;
  }
}

export const FREE_PR_SUMMARY_LIMIT = 3;

/** Count org-scoped review_usage rows (one per bookmark / PR Summary). */
export async function checkPrSummaryQuota(
  db: postgres.Sql,
  orgId: string,
  bookmarkId?: string,
): Promise<QuotaCheckResult> {
  const [row] = await db<{ count: string }[]>`
    SELECT COUNT(*)::TEXT AS count
    FROM review_usage
    WHERE org_id = ${orgId}
  `;
  const used = Number.parseInt(row?.count ?? "0", 10);

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

  const upgradeUrl = getUpgradeCheckoutUrl(orgId);
  return {
    allowed: used < FREE_PR_SUMMARY_LIMIT || alreadyCounted,
    used,
    limit: FREE_PR_SUMMARY_LIMIT,
    upgradeUrl,
  };
}

export async function assertPrSummaryQuota(
  db: postgres.Sql,
  orgId: string,
  bookmarkId?: string,
): Promise<QuotaCheckResult> {
  const result = await checkPrSummaryQuota(db, orgId, bookmarkId);
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
  return [
    "GX PR Summary quota reached for this org.",
    `Used ${result.used} of ${result.limit} free PR Summaries.`,
    `Upgrade: ${result.upgradeUrl}`,
  ].join("\n");
}
