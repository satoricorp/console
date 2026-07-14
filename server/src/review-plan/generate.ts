import type postgres from "postgres";
import {
  createReviewProviders,
  type LLMProvider,
} from "../llm/provider";
import {
  REVIEW_PLAN_SYSTEM_PROMPT,
  buildReviewPlanUserPrompt,
} from "../llm/prompts/review-plan";
import { loadReviewPlanContext } from "./context";
import type { ReviewPlan, UsageBreakdown } from "./types";
import {
  isCurrentReviewPlan,
  parseAndValidateReviewPlan,
  scoreReviewPlanCandidate,
} from "./validate";

export type GenerateReviewPlanInput = {
  orgId: string;
  bookmarkId: string;
  headCommitId: string;
  eventId?: string | null;
  force?: boolean;
  providers?: LLMProvider[];
};

export type GenerateReviewPlanResult = {
  status: "ready" | "failed" | "skipped";
  planId: string | null;
  plan: ReviewPlan | null;
  usage: UsageBreakdown | null;
  model: string | null;
  provider: string | null;
  error: string | null;
  latencyMs: number;
};

/**
 * Generate (or reuse) a review plan for bookmark@head.
 * Idempotent: ON CONFLICT re-runs only when failed or forced.
 */
export async function generateReviewPlan(
  db: postgres.Sql,
  input: GenerateReviewPlanInput,
): Promise<GenerateReviewPlanResult> {
  const now = Date.now();

  if (!input.force) {
    const [existing] = await db<{
      id: string;
      status: string;
      plan: ReviewPlan | null;
      usage: UsageBreakdown | null;
      model: string | null;
      provider: string | null;
      error: string | null;
    }[]>`
      SELECT id, status, plan, usage, model, provider, error
      FROM review_plans
      WHERE bookmark_id = ${input.bookmarkId}::uuid
        AND head_commit_id = ${input.headCommitId}
      LIMIT 1
    `;
    if (
      existing?.status === "ready" &&
      existing.plan &&
      isCurrentReviewPlan(existing.plan)
    ) {
      return {
        status: "skipped",
        planId: existing.id,
        plan: existing.plan,
        usage: existing.usage,
        model: existing.model,
        provider: existing.provider,
        error: null,
        latencyMs: 0,
      };
    }
    if (existing?.status === "pending") {
      return {
        status: "skipped",
        planId: existing.id,
        plan: null,
        usage: existing.usage,
        model: null,
        provider: null,
        error: null,
        latencyMs: 0,
      };
    }
  }

  // Upsert pending row
  const [row] = await db<{ id: string }[]>`
    INSERT INTO review_plans (
      org_id, bookmark_id, event_id, head_commit_id,
      status, created_at_ms, updated_at_ms
    ) VALUES (
      ${input.orgId}::uuid,
      ${input.bookmarkId}::uuid,
      ${input.eventId ?? null}::uuid,
      ${input.headCommitId},
      'pending',
      ${now},
      ${now}
    )
    ON CONFLICT (bookmark_id, head_commit_id) DO UPDATE SET
      status = 'pending',
      event_id = COALESCE(EXCLUDED.event_id, review_plans.event_id),
      error = NULL,
      updated_at_ms = ${now}
    RETURNING id
  `;

  const planId = row?.id ?? null;
  const started = Date.now();

  try {
    const ctx = await loadReviewPlanContext(db, {
      orgId: input.orgId,
      bookmarkId: input.bookmarkId,
      eventId: input.eventId,
      headCommitId: input.headCommitId,
    });

    if (!ctx) {
      const error = "artifact_missing";
      await markFailed(db, planId, error, Date.now() - started);
      return {
        status: "failed",
        planId,
        plan: null,
        usage: null,
        model: null,
        provider: null,
        error,
        latencyMs: Date.now() - started,
      };
    }

    // Persist usage early so the UI can show tokens while generating
    await db`
      UPDATE review_plans
      SET usage = ${db.json(ctx.usage as never)}, updated_at_ms = ${Date.now()}
      WHERE id = ${planId}::uuid
    `;

    const providers =
      input.providers ??
      createReviewProviders(
        ctx.intent.selfReport?.taskSummary ||
          ctx.intent.descriptions[0] ||
          ctx.title ||
          "review plan",
      );

    const userPrompt = buildReviewPlanUserPrompt(ctx);
    type Run = {
      provider: string;
      model: string;
      plan: ReviewPlan | null;
      score: number;
      error: string | null;
    };
    const runs: Run[] = [];

    for (const provider of providers) {
      try {
        const completion = await provider.complete(
          REVIEW_PLAN_SYSTEM_PROMPT,
          userPrompt,
        );
        const validated = parseAndValidateReviewPlan(completion.text, ctx);
        runs.push({
          provider: provider.name,
          model: completion.model,
          plan: validated.plan,
          score: scoreReviewPlanCandidate(validated),
          error: validated.ok ? null : validated.error ?? "invalid",
        });
      } catch (error) {
        runs.push({
          provider: provider.name,
          model: "unknown",
          plan: null,
          score: 0,
          error: error instanceof Error ? error.message : "provider_error",
        });
      }
    }

    const best = runs
      .filter((r): r is Run & { plan: ReviewPlan } => Boolean(r.plan))
      .sort((a, b) => b.score - a.score)[0];

    const latencyMs = Date.now() - started;

    if (!best) {
      const error = runs.find((r) => r.error)?.error ?? "generation_failed";
      await db`
        UPDATE review_plans SET
          status = 'failed',
          error = ${error},
          usage = ${db.json(ctx.usage as never)},
          latency_ms = ${latencyMs},
          updated_at_ms = ${Date.now()}
        WHERE id = ${planId}::uuid
      `;
      return {
        status: "failed",
        planId,
        plan: null,
        usage: ctx.usage,
        model: null,
        provider: null,
        error,
        latencyMs,
      };
    }

    await db`
      UPDATE review_plans SET
        status = 'ready',
        plan = ${db.json(best.plan as never)},
        usage = ${db.json(ctx.usage as never)},
        model = ${best.model},
        provider = ${best.provider},
        error = NULL,
        latency_ms = ${latencyMs},
        updated_at_ms = ${Date.now()}
      WHERE id = ${planId}::uuid
    `;

    return {
      status: "ready",
      planId,
      plan: best.plan,
      usage: ctx.usage,
      model: best.model,
      provider: best.provider,
      error: null,
      latencyMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "generation_failed";
    await markFailed(db, planId, message, Date.now() - started);
    return {
      status: "failed",
      planId,
      plan: null,
      usage: null,
      model: null,
      provider: null,
      error: message,
      latencyMs: Date.now() - started,
    };
  }
}

async function markFailed(
  db: postgres.Sql,
  planId: string | null,
  error: string,
  latencyMs: number,
): Promise<void> {
  if (!planId) return;
  await db`
    UPDATE review_plans SET
      status = 'failed',
      error = ${error},
      latency_ms = ${latencyMs},
      updated_at_ms = ${Date.now()}
    WHERE id = ${planId}::uuid
  `;
}

/** Fire-and-forget enqueue used by publish + GET auto-generate. */
export function enqueueReviewPlanGeneration(
  db: postgres.Sql,
  input: GenerateReviewPlanInput,
): void {
  void generateReviewPlan(db, input).catch((error) => {
    console.error("Review plan generation failed", {
      bookmarkId: input.bookmarkId,
      headCommitId: input.headCommitId,
      error,
    });
  });
}
