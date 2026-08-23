/**
 * Token-true text bounds, shared by the Convex indexer and the server's
 * embedding path.
 *
 * Characters are not a proxy for tokens, which this codebase learned three
 * times: satoricorp/console failed on a minified bundle, satoricorp/gx failed
 * on a binary fixture whose decoded bytes tokenized at one token per
 * character, and then the server's embedding path — which had no bound at all
 * while the Convex indexer had this one — 500ed every code-review-history
 * search for a large enough diff. The third failure was the two paths not
 * sharing this file, which is why it now sits outside both.
 *
 * It imports nothing on purpose. Convex resolves dependencies from the repo
 * root and the server resolves them from server/node_modules, so a file
 * outside both trees has no reliable way to import js-tiktoken — CI installs
 * only server/, and a shared import of it fails there. The encoder is injected
 * instead: each side spends five lines naming its tokenizer, and the parts
 * worth getting wrong — the slicing, the budget arithmetic, the boundary
 * handling — exist once.
 */

/** The slice of js-tiktoken's Tiktoken that the clamp needs. */
export type TokenEncoder = {
  encode(text: string, allowedSpecial?: string[], disallowedSpecial?: string[]): number[];
  decode(tokens: number[]): string;
};

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
 * clampToTokens must leave more headroom against a hard API limit than three
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

/**
 * Builds the pair of bounds against one tokenizer. The encoder is constructed
 * lazily and once: js-tiktoken parses a megabyte of ranks to build it, which
 * is wasted on a process that never clamps anything.
 */
export function createTokenClamp(newEncoder: () => TokenEncoder): {
  countTokens: (text: string) => number;
  clampToTokens: (text: string, maxTokens: number) => string;
} {
  let encoder: TokenEncoder | null = null;
  const getEncoder = (): TokenEncoder => (encoder ??= newEncoder());

  // Empty allow/disallow lists: a repository that works on AI tooling can
  // contain literal `<|endoftext|>` in prompt files, and the encoder's
  // default is to throw on it. This makes it ordinary text.
  const encodeSlice = (slice: string): number[] => getEncoder().encode(slice, [], []);

  /**
   * Number of tokens in `text`, counted slice-wise (see SLICE_CHARS — an upper
   * bound on the true count, at most a few tokens per slice over).
   */
  function countTokens(text: string): number {
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
   * The kept prefix is returned verbatim; only the slice the budget runs out
   * in is cut by decoding its in-budget tokens, which can land inside a
   * multi-token character and mangle the final one. One mangled trailing
   * character on an already-truncated tail is accepted — the alternative on
   * such input is no index at all.
   */
  function clampToTokens(text: string, maxTokens: number): string {
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

  return { countTokens, clampToTokens };
}
