"use node";

import OpenAI from "openai";
import { withRetry } from "./retry";

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 64;

/**
 * Hard ceiling on one embedding input, in characters.
 *
 * text-embedding-3-small accepts 8192 tokens and rejects the whole request
 * above it — not the offending item, the request — so one oversized chunk
 * fails its entire batch and, because a batch failure aborts the run, the
 * entire index. That is what happened to satoricorp/console: it stopped at
 * file 250 of 421 with `400 Invalid 'input[0]': maximum input length is 8192
 * tokens`, leaving a partial index and a failed job.
 *
 * The chunker bounds by lines, which does not bound tokens: a hundred lines of
 * minified JavaScript, embedded JSON, or long single-line SQL is far past the
 * limit while still under the 100KB per-file cap.
 *
 * 20000 characters is roughly 5000-6600 tokens for source at 3-4 characters
 * per token, which leaves room for the tokenizer being less efficient than
 * that on dense or non-English text. Truncating one chunk loses the tail of
 * one window; the alternative on the same input is no index at all.
 */
const MAX_INPUT_CHARS = 20000;

export function clampEmbeddingInput(text: string): string {
  return text.length <= MAX_INPUT_CHARS ? text : text.slice(0, MAX_INPUT_CHARS);
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
