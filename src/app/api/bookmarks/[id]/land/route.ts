import { fetchAuthAction, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import {
  getBookmarkMetaForUser,
  loadBookmarkPayload,
  markBookmarkMergedForUser,
} from "@/lib/local-postgres";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;

  try {
    const meta = await getBookmarkMetaForUser(user._id, bookmarkId);
    if (!meta) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const payload = await loadBookmarkPayload(bookmarkId);
    const result = await fetchAuthAction(api.gxPrActions.landBookmark, {
      bookmarkId,
      payload: payload ?? undefined,
      repoFullName: meta.repoFullName,
      skipBookmarkDbWrites: true,
    });

    await markBookmarkMergedForUser(user._id, bookmarkId, result.sha);

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to land bookmark";
    return Response.json({ error: message }, { status: 503 });
  }
}
