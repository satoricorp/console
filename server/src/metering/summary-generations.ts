import type postgres from "postgres";
import type { GithubPostSkipSource } from "./github-post-skips";

export type SummaryGenerationSource = "webhook" | "console";

export type RecordSummaryGenerationInput = {
  orgId: string;
  userId?: string | null;
  bookmarkId: string;
  summaryId: string;
  source: SummaryGenerationSource;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

/** Collapse a quota-skip source onto the generation ledger's coarser buckets. */
export function summaryGenerationSource(
  source: GithubPostSkipSource | undefined,
): SummaryGenerationSource {
  return source === "github_webhook" ? "webhook" : "console";
}

/**
 * Append one row per PR Summary generation. Unlike review_usage (a quota dedup
 * key that ignores regenerations), every call writes a row, so per-user counts
 * survive synchronize pushes.
 *
 * Never throws — metering must not fail the webhook or publish paths.
 */
export async function recordSummaryGeneration(
  db: postgres.Sql,
  input: RecordSummaryGenerationInput,
): Promise<void> {
  try {
    await db`
      INSERT INTO summary_generations (
        org_id,
        user_id,
        bookmark_id,
        summary_id,
        source,
        model,
        input_tokens,
        output_tokens,
        created_at_ms
      ) VALUES (
        ${input.orgId},
        ${input.userId ?? null},
        ${input.bookmarkId},
        ${input.summaryId},
        ${input.source},
        ${input.model ?? null},
        ${input.inputTokens ?? null},
        ${input.outputTokens ?? null},
        ${Date.now()}
      )
    `;
  } catch (error) {
    console.error("summary generation metering failed", {
      orgId: input.orgId,
      bookmarkId: input.bookmarkId,
      source: input.source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
