import { fetchAuthAction, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { gxApiJson, gxApiRequest } from "@/lib/gx-api-server";
import { publishContextFromBookmark } from "@/lib/bookmark-action-context";
import type { ConsoleBookmark } from "@/lib/bookmarks-client";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await fetchAuthQuery(api.auth.getAuthUser, {});
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookmarkId } = await context.params;
  const includeCiChecks =
    new URL(request.url).searchParams.get("include_ci_checks") === "1";

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

    const status = await fetchAuthAction(api.gxPrActions.getPublishStatus, {
      bookmarkId,
      publishContext: publishContextFromBookmark(bookmark, bookmark.payload),
      includeCiChecks,
    });

    if (status.integratedOnBase) {
      await gxApiRequest(
        user._id,
        `/bookmarks/${encodeURIComponent(bookmarkId)}/mark-merged`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            remoteHeadSha: status.remoteHeadSha ?? undefined,
          }),
        },
      );
    }

    return Response.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load publish status";
    return Response.json({ error: message }, { status: 503 });
  }
}
