import { ingestCliBookmark, ingestDevBookmark } from "./convex-client";
import type { AuthContext } from "./types";
import type { BookmarkSyncPayload } from "./types";

export async function syncPushToConvex(
  cliToken: string,
  bookmark: BookmarkSyncPayload,
  auth: AuthContext,
): Promise<void> {
  const devKey = process.env.GX_CLOUD_API_KEY?.trim();
  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();

  if (devKey && cliToken === devKey && webhookSecret) {
    await ingestDevBookmark(
      webhookSecret,
      auth.userId,
      auth.sessionId,
      bookmark,
    );
    return;
  }

  await ingestCliBookmark(cliToken, bookmark);
}
