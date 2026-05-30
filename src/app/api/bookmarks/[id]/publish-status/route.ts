import { fetchAuthAction, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import {
  getBookmarkMetaForUser,
  loadBookmarkPayload,
  markBookmarkMergedForUser,
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
  const includeCiChecks =
    new URL(request.url).searchParams.get("include_ci_checks") === "1";

  try {
    const meta = await getBookmarkMetaForUser(user._id, bookmarkId);
    if (!meta) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const payload = await loadBookmarkPayload(bookmarkId);
    const status = await fetchAuthAction(api.gxPrActions.getPublishStatus, {
      bookmarkId,
      payload: payload ?? undefined,
      repoFullName: meta.repoFullName,
      includeCiChecks,
      skipBookmarkDbWrites: true,
    });

    if (status.integratedOnBase) {
      await markBookmarkMergedForUser(
        user._id,
        bookmarkId,
        status.remoteHeadSha ?? undefined,
      );
    }

    return Response.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load publish status";
    return Response.json({ error: message }, { status: 503 });
  }
}
