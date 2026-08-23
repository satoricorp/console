import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";
import { createTokenClamp } from "../../../shared/tokenClamp";

/**
 * cl100k_base is what text-embedding-3-small counts with, so bounds computed
 * here are the bounds the API enforces. The clamp itself is in shared/ — see
 * the header there for why naming the tokenizer is all that lives on this side.
 */
export const { countTokens, clampToTokens } = createTokenClamp(
  () => new Tiktoken(cl100k_base),
);
