/** Prefer the action's Error message over Convex's "Server Error" wrapper. */
export function userFacingActionError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return fallback;
  }
  const message = error.message.trim();
  const uncaught = message.match(
    /Uncaught (?:Error|ConvexError):\s*([\s\S]+?)(?:\n|$)/,
  );
  if (uncaught?.[1]?.trim()) {
    return uncaught[1].trim();
  }
  const afterServer = message.split(/Server Error\s*/i).pop()?.trim();
  if (afterServer && afterServer !== message) {
    return afterServer.replace(/^Uncaught Error:\s*/i, "").trim() || fallback;
  }
  return message;
}
