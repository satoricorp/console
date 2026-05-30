import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../../convex/_generated/api";
import { gxApiJson } from "@/lib/gx-api-server";

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
    const bookmark = await gxApiJson(user._id, `/bookmarks/${encodeURIComponent(bookmarkId)}/close`, {
      method: "POST",
    });
    return Response.json(bookmark);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to archive bookmark";
    const status = message.includes("only open bookmarks") ? 409 : 503;
    return Response.json({ error: message }, { status });
  }
}
