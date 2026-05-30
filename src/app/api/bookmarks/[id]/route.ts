import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";
import {
  getBookmarkMetaForUser,
  loadBookmarkPayload,
} from "@/lib/local-postgres";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const includePayload =
    new URL(request.url).searchParams.get("include_payload") === "1";

  try {
    const meta = await getBookmarkMetaForUser(user._id, bookmarkId);
    if (!meta) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (!includePayload) {
      return Response.json(meta);
    }

    const payload = await loadBookmarkPayload(bookmarkId);
    return Response.json({ ...meta, payload: payload ?? undefined });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load bookmark";
    return Response.json({ error: message }, { status: 503 });
  }
}
