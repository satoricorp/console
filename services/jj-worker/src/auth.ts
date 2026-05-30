import type { Context, Next } from "hono";

export function requireServiceAuth(expectedApiKey: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : null;

    if (!token || token !== expectedApiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
