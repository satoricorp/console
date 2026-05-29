import { createMiddleware } from "hono/factory";
import { resolveCliToken } from "../convex-client";
import { devAuthContext } from "../dev-auth";
import type { AuthContext } from "../types";

export type AppEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();
  const serverUserId = c.req.header("X-GX-User-Id")?.trim();
  const serverSecret = c.req.header("X-GX-Webhook-Secret")?.trim();
  if (webhookSecret && serverSecret === webhookSecret && serverUserId) {
    c.set("auth", {
      userId: serverUserId,
      githubUserId: 0,
      githubUserLogin: "console",
      sessionId: "console",
      machineId: "console",
    });
    await next();
    return;
  }

  const token = bearerToken(c.req.header("Authorization"));
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const devAuth = devAuthContext(token);
    if (devAuth) {
      c.set("auth", devAuth);
      await next();
      return;
    }

    const resolved = await resolveCliToken(token);
    if (!resolved) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("auth", {
      userId: resolved.userId,
      githubUserId: resolved.githubUserId,
      githubUserLogin: resolved.githubLogin,
      sessionId: resolved.sessionId,
      machineId: resolved.machineId,
    });
  } catch (error) {
    console.error("Convex auth resolve failed", error);
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

export function canAccessEvent(
  auth: AuthContext,
  event: { userId: string | null; githubUserId: number | null },
): boolean {
  if (auth.userId && event.userId) {
    return auth.userId === event.userId;
  }
  if (auth.githubUserId !== null && event.githubUserId !== null) {
    return auth.githubUserId === event.githubUserId;
  }
  return false;
}
