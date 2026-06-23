import { Hono } from "hono";
import { requireAuth, type AppEnv } from "../middleware/auth";

export const authRoutes = new Hono<AppEnv>();

authRoutes.use("/v1/auth/*", requireAuth);

authRoutes.get("/v1/auth/me", async (c) => {
  const auth = c.get("auth");
  return c.json({
    org_id: auth.orgId,
    user_id: auth.userId,
    token_label: auth.tokenLabel,
    github_user_id: auth.githubUserId,
    github_user_login: auth.githubUserLogin,
    session_id: auth.sessionId,
    machine_id: auth.machineId,
  });
});
