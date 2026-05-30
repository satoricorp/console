import { fetchAuthAction, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { gxApiJson, gxApiRequest } from "@/lib/gx-api-server";
import { publishContextFromBookmark } from "@/lib/bookmark-action-context";
import type { ConsoleBookmark } from "@/lib/bookmarks-client";

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
    const bookmark = await gxApiJson<ConsoleBookmark>(
      user._id,
      `/bookmarks/${encodeURIComponent(bookmarkId)}?include_payload=1`,
    );
    if (!bookmark.payload) {
      return Response.json(
        { error: "Bookmark payload not found. Run gx pr to sync." },
        { status: 404 },
      );
    }

    const result = await fetchAuthAction(api.gxPrActions.landBookmark, {
      bookmarkId,
      publishContext: publishContextFromBookmark(bookmark, bookmark.payload),
    });

    await gxApiRequest(
      user._id,
      `/bookmarks/${encodeURIComponent(bookmarkId)}/mark-merged`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteHeadSha: result.sha }),
      },
    );

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to land bookmark";
    return Response.json({ error: message }, { status: 503 });
  }
}
