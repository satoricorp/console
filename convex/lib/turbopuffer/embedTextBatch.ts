"use node";

import OpenAI from "openai";
import { withRetry } from "./retry";
import { clampToTokens } from "./tokenClamp";

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 64;

/**
 * Hard ceiling on one embedding input.
 *
 * text-embedding-3-small accepts 8192 tokens and rejects the whole request
 * above it — not the offending item, the request — so one oversized input
 * fails its entire batch and, because a batch failure aborts the run, the
 * entire index. satoricorp/console died that way at file 250 of 421, and
 * satoricorp/gx at file 0 of 685 on a binary fixture.
 *
 * The gx failure is why this ceiling is measured in tokens, not characters: a
 * character bound assumes a chars-per-token ratio, and binary or CJK content
 * breaks the assumption — 12420 characters of decoded SQLite was 11735
 * tokens. The chunker enforces its own, tighter token bound so stored text
 * matches the embedded text; this one is the independent backstop protecting
 * every caller of this module. Truncating one input loses the tail of one
 * window; the alternative on the same input is no index at all.
 */
const MAX_INPUT_TOKENS = 8000;
/** Pre-clamp in characters, only to bound the cost of exact token counting. */
const MAX_INPUT_CHARS = 20000;

export function clampEmbeddingInput(text: string): string {
  const charClamped =
    text.length <= MAX_INPUT_CHARS ? text : text.slice(0, MAX_INPUT_CHARS);
  return clampToTokens(charClamped, MAX_INPUT_TOKENS);
}

let openai: OpenAI | null = null;

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export async function embedTextBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getOpenAI();
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(clampEmbeddingInput);
    const response = await withRetry(
      () =>
        client.embeddings.create({
          model: MODEL,
          input: batch,
        }),
      { maxAttempts: 4, baseMs: 1000 },
    );

    for (const item of response.data.sort((a, b) => a.index - b.index)) {
      vectors.push(item.embedding);
    }
  }

  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTextBatch([text]);
  return vector;
}
