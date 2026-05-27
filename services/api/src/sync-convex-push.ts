import { ingestCliPush, ingestDevPush } from "./convex-client";
import type { AuthContext } from "./types";
import type { PushBundle } from "./types";

function trimPushPayload(payload: PushBundle): PushBundle {
  const trimmed: PushBundle = { ...payload };
  if (Array.isArray(trimmed.stack) && trimmed.stack.length > 0) {
    trimmed.sessions = [];
    return trimmed;
  }
  if (Array.isArray(trimmed.sessions)) {
    trimmed.sessions = trimmed.sessions.map((session) => ({
      ...session,
      requests: session.requests.map((request) => ({
        ...request,
        request_body: undefined,
        request_headers: "",
        responses: request.responses.map((response) => ({
          ...response,
          response_body: undefined,
          response_headers: "",
        })),
      })),
    }));
  }
  return trimmed;
}

export async function syncPushToConvex(
  cliToken: string,
  payload: PushBundle,
  auth: AuthContext,
): Promise<void> {
  const trimmed = trimPushPayload(payload);
  const devKey = process.env.GX_CLOUD_API_KEY?.trim();
  const webhookSecret = process.env.GX_WEBHOOK_SECRET?.trim();

  if (devKey && cliToken === devKey && webhookSecret) {
    await ingestDevPush(webhookSecret, auth.userId, auth.sessionId, trimmed);
    return;
  }

  await ingestCliPush(cliToken, trimmed);
}
