/** WP-5b encryption stub — passthrough in dev until org vault lands. */
export function decryptSessionContent(content: string): string {
  const allowPlaintext =
    process.env.GX_ALLOW_PLAINTEXT_SESSIONS !== "0" &&
    process.env.GX_ALLOW_PLAINTEXT_SESSIONS !== "false";
  if (allowPlaintext) {
    return content;
  }
  // Future: decrypt with org hosted_vault key id.
  return content;
}
