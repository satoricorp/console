/** Full gx pr payloads (including captured sessions) live in Postgres only. */

/** Console/Convex index: stack + change metadata. Sessions are not copied. */
export function consolePayloadForConvex(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  return {
    event: record.event,
    created_at: record.created_at,
    gx_version: record.gx_version,
    repo: record.repo,
    push: record.push,
    change: record.change,
    stack: record.stack,
  };
}
