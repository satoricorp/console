export function debugTimingEnabled(): boolean {
  return process.env.DEBUG_TIMING?.trim().toLowerCase() === "true";
}

export function timingNow(): number {
  return performance.now();
}

export function logTiming(
  action: string,
  startedAt: number,
  fields: Record<string, unknown> = {},
): void {
  if (!debugTimingEnabled()) {
    return;
  }
  console.info("[tx timing]", {
    scope: "api",
    action,
    elapsedMs: Math.round((timingNow() - startedAt) * 100) / 100,
    ...fields,
  });
}
