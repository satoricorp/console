import { ingestCliPush } from "./convex-client";
import type { AuthContext } from "./types";
import type { PushBundle } from "./types";

export async function syncPushToConvex(
  cliToken: string,
  payload: PushBundle,
  auth: AuthContext,
): Promise<void> {
  const devKey = process.env.GX_CLOUD_API_KEY?.trim();
  const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/$/, "");
  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();

  if (devKey && cliToken === devKey && siteUrl && webhookSecret) {
    const response = await fetch(`${siteUrl}/gx/pr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gx-webhook-secret": webhookSecret,
      },
      body: JSON.stringify({
        user_id: auth.userId,
        session_id: auth.sessionId,
        payload,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Convex gx/pr sync failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    return;
  }

  await ingestCliPush(cliToken, payload);
}
