import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

/**
 * cl100k_base is what text-embedding-3-small counts with, so bounds computed
 * here are the bounds the API enforces — unlike characters, which the console
 * index learned twice are not a proxy for tokens: satoricorp/console failed on
 * a minified bundle, then satoricorp/gx failed on a binary fixture whose
 * decoded bytes tokenized at one token per character, sailing a 16000-character
 * "clamped" chunk past the 8192-token request limit.
 */
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = new Tiktoken(cl100k_base);
  }
  return encoder;
}

/**
 * Text is encoded in slices of this many characters, never whole.
 *
 * js-tiktoken's BPE is quadratic in the length of one regex piece, and the
 * pre-tokenizer splits on spaces — which CJK prose and minified bundles don't
 * have, so a 16000-character chunk of either is one piece and encodes in
 * minutes, not milliseconds. Slicing caps the piece length.
 *
 * Slice boundaries perturb the count by a token or two each (a forgone merge
 * overcounts; a split surrogate pair can undercount), so budgets passed to
 * clampToTokens must leave more headroom against the API's 8192 than three
 * tokens per slice of input — hundreds, at these sizes.
 */
const SLICE_CHARS = 400;

/**
 * One UTF-16 code unit encodes to at most three UTF-8 bytes, and byte-level
 * BPE emits at most one token per byte, so `3 × length` bounds the token
 * count from above without encoding anything.
 */
function tokensUpperBound(text: string): number {
  return text.length * 3;
}

function encodeSlice(slice: string): number[] {
  // Empty allow/disallow lists: a repository that works on AI tooling can
  // contain literal `<|endoftext|>` in prompt files, and the encoder's
  // default is to throw on it. This makes it ordinary text.
  return getEncoder().encode(slice, [], []);
}

/**
 * Number of cl100k tokens in `text`, counted slice-wise (see SLICE_CHARS —
 * an upper bound on the true count, at most a few tokens per slice over).
 */
export function countTokens(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i += SLICE_CHARS) {
    total += encodeSlice(text.slice(i, i + SLICE_CHARS)).length;
  }
  return total;
}

/**
 * Truncates `text` so its slice-counted tokens — and therefore its true
 * tokens — fit in `maxTokens`.
 *
 * The kept prefix is returned verbatim; only the slice the budget runs out in
 * is cut by decoding its in-budget tokens, which can land inside a
 * multi-token character and mangle the final one. One mangled trailing
 * character on an already-truncated tail is accepted — the alternative on
 * such input is no index at all.
 */
export function clampToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (tokensUpperBound(text) <= maxTokens) return text;

  let spent = 0;
  for (let i = 0; i < text.length; i += SLICE_CHARS) {
    const slice = text.slice(i, i + SLICE_CHARS);
    const tokens = encodeSlice(slice);
    if (spent + tokens.length > maxTokens) {
      return (
        text.slice(0, i) + getEncoder().decode(tokens.slice(0, maxTokens - spent))
      );
    }
    spent += tokens.length;
  }
  return text;
}
