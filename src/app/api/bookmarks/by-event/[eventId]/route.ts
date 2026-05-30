import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { gxApiJson } from "@/lib/gx-api-server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { eventId } = await context.params;

  try {
    const body = await gxApiJson<{ bookmarkId: string | null }>(
      user._id,
      `/bookmarks/by-event/${encodeURIComponent(eventId)}`,
    );
    return Response.json(body);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve bookmark";
    return Response.json({ error: message }, { status: 503 });
  }
}
