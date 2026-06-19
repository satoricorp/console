import { Hono } from "hono";
import { getSql } from "../db";
import type { AppEnv } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

export const FREE_FULL_STACK_REVIEW_LIMIT = 3;

export const usageRoutes = new Hono<AppEnv>();

usageRoutes.use("*", requireAuth);

usageRoutes.get("/reviews", async (c) => {
  const auth = c.get("auth");
  const db = getSql();

  const [row] = await db<{ count: string }[]>`
    SELECT COUNT(*)::TEXT AS count
    FROM gx_review_usage
    WHERE user_id = ${auth.userId}
  `;

  const fullStackReviewsUsed = Number.parseInt(row?.count ?? "0", 10);
  const freeReviewsRemaining = Math.max(
    0,
    FREE_FULL_STACK_REVIEW_LIMIT - fullStackReviewsUsed,
  );

  return c.json({
    freeReviewLimit: FREE_FULL_STACK_REVIEW_LIMIT,
    fullStackReviewsUsed,
    freeReviewsRemaining,
    freeReviewsExhausted: freeReviewsRemaining === 0,
  });
});
