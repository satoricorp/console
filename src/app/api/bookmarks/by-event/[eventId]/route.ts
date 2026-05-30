import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { resolveBookmarkIdForEvent } from "@/lib/local-postgres";

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
    const bookmarkId = await resolveBookmarkIdForEvent(user._id, eventId);
    return Response.json({ bookmarkId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve bookmark";
    return Response.json({ error: message }, { status: 503 });
  }
}
