"use node";

import OpenAI from "openai";
import { withRetry } from "./retry";

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 64;

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
    const batch = texts.slice(i, i + BATCH_SIZE);
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
